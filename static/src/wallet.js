let network = {chainId: 42220, profile: 'mainnet', chainName: 'Celo', rpcUrls: ['https://forno.celo.org'], explorerUrl: 'https://celoscan.io', nativeCurrency: {name: 'CELO', symbol: 'CELO', decimals: 18}};
let localAccount;
let demoAccounts = [];
let provider;
let selectedAccount;
let accountHandler;
let chainHandler;
let disconnectHandler;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
function firstAccount(accounts) { return Array.isArray(accounts) && addressPattern.test(accounts[0]) ? accounts[0] : undefined; }
function announce(account) { window.dispatchEvent?.(new CustomEvent('cropguard:walletchange', {detail:{account}})); }
export function currentAccount() { return selectedAccount; }
export function getProvider() { return provider; }
export function configureNetwork(value, accounts = []) {
  if (!value || !((value.profile === 'mainnet' && value.chainId === 42220) || (value.profile === 'local' && value.chainId === 31337 && value.demoOnly === true))) throw new Error('Unsupported deployment network.');
  network = value;
  demoAccounts = accounts.filter(a => addressPattern.test(a.address));
  if (network.profile === 'local') localAccount = demoAccounts[0]?.address;
}
export function selectLocalAccount(account) {
  if (network.profile !== 'local' || !demoAccounts.some(a => a.address.toLowerCase() === account?.toLowerCase())) throw new Error('Choose a known local test identity.');
  localAccount = account;
  selectedAccount = account;
  provider = localProvider;
  window.cropguardWalletProvider = provider;
  accountHandler?.([account]);
  announce(account);
}
const localProvider = {
  async request({method, params = []}) {
    if (network.profile !== 'local') throw new Error('Local wallet is disabled.');
    if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return localAccount ? [localAccount] : [];
    if (!['eth_chainId', 'personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(method)) throw new Error('Unsupported local wallet method.');
    const response = await fetch('/api/demo/wallet', {method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify({method,params})});
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Local wallet request failed.');
    return body.result;
  }
};
export async function connect(onChange) {
  if (accountHandler) provider?.removeListener?.('accountsChanged', accountHandler);
  if (chainHandler) provider?.removeListener?.('chainChanged', chainHandler);
  if (disconnectHandler) provider?.removeListener?.('disconnect', disconnectHandler);
  provider = network.profile === 'local' ? localProvider : window.ethereum;
  window.cropguardWalletProvider = provider;
  selectedAccount = undefined;
  onChange(undefined);
  if (!provider?.request) throw new Error('No injected EVM wallet was detected. Install a compatible wallet in your browser. Never enter a seed phrase on this site.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!firstAccount(accounts)) throw new Error('Wallet returned no valid accounts.');
  await ensureChain();
  selectedAccount = firstAccount(await provider.request({ method: 'eth_accounts' }));
  if (!selectedAccount) throw new Error('Wallet disconnected while connecting. Try again.');
  accountHandler = values => { selectedAccount = firstAccount(values); onChange(selectedAccount); announce(selectedAccount); };
  chainHandler = () => { selectedAccount = undefined; onChange(undefined); announce(undefined); };
  disconnectHandler = () => { selectedAccount = undefined; onChange(undefined); announce(undefined); };
  provider.on?.('accountsChanged', accountHandler);
  provider.on?.('chainChanged', chainHandler);
  provider.on?.('disconnect', disconnectHandler);
  announce(selectedAccount);
  return selectedAccount;
}
export async function ensureChain() {
  if (!provider) throw new Error('Connect your wallet first.');
  const current = Number(BigInt(await provider.request({ method: 'eth_chainId' })));
  if (current !== network.chainId) {
    const hexChain = '0x' + network.chainId.toString(16);
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain, chainName: network.chainName, nativeCurrency: network.nativeCurrency, rpcUrls: network.rpcUrls, ...(network.explorerUrl ? {blockExplorerUrls: [network.explorerUrl]} : {}) }] });
    }
  }
  const final = Number(BigInt(await provider.request({ method: 'eth_chainId' })));
  if (final !== network.chainId) throw new Error(`Wallet must be on ${network.chainName} (${network.chainId}).`);
}
export async function sendPrepared(prepared, allowedAddresses) {
  await ensureChain();
  const tx = {...prepared.transaction};
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!firstAccount(accounts) || accounts[0].toLowerCase() !== selectedAccount?.toLowerCase()) throw new Error('Wallet account changed. Reconnect and prepare again.');
  const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
  if (!addressPattern.test(tx.from) || !addressPattern.test(tx.to) ||
      !quantity(tx.chainId) || !quantity(tx.value) || !quantity(tx.gas) || BigInt(tx.gas) < 1n || BigInt(tx.gas) > 2400000n ||
      typeof tx.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(tx.data) ||
      Object.keys(tx).some(key => !['from', 'to', 'chainId', 'value', 'gas', 'data'].includes(key))) {
    throw new Error('Prepared transaction contains invalid or unexpected fields.');
  }
  if (prepared.chainId !== network.chainId || Number(BigInt(tx.chainId)) !== network.chainId ||
      tx.from.toLowerCase() !== selectedAccount.toLowerCase() || BigInt(tx.value) !== 0n ||
      !allowedAddresses.some(a => addressPattern.test(a) && a.toLowerCase() === tx.to.toLowerCase())) {
    throw new Error('Prepared transaction failed destination/chain/account checks.');
  }
  return provider.request({ method: 'eth_sendTransaction', params: [tx] });
}

"""R-compatible Gamma fit and random draws, using only the Python standard library.

Reproduces the team's R script (CropGuard_MC.R): MASS::fitdistr(x, "gamma"),
set.seed(seed), rgamma(n, shape, rate) and rnorm(n, 0, sd) under R's default
generators (Mersenne-Twister, Inversion). The algorithms follow R's C sources
(RNG.c, snorm.c, sexp.c, rgamma.c, qnorm.c, optim.c). Draws match R bit for bit
when the platform's libm agrees with R's; the Gamma log-density is evaluated in
closed form rather than with R's dpois_raw, so the fitted parameters agree with R
to about ten significant digits, not to the last bit.
"""
from __future__ import annotations

from fractions import Fraction
import math

_N, _M = 624, 397
_MATRIX_A, _UPPER, _LOWER = 0x9908B0DF, 0x80000000, 0x7FFFFFFF
_I2_32M1 = 2.328306437080797e-10  # 1/(2^32 - 1)
_BIG = 134217728  # 2^27, norm_rand() Inversion


class RRandom:
    """R's default random number generation after set.seed(seed)."""

    def __init__(self, seed: int):
        if type(seed) is not int or not 0 <= seed <= 2**32 - 1:
            raise ValueError("Seed must be an unsigned 32-bit integer.")
        # R's set.seed() takes a signed 32-bit integer and works on its bits as
        # unsigned; seeds of 2^31 and above equal set.seed(seed - 2^32) in R.
        state = seed
        for _ in range(50):
            state = (69069 * state + 1) & 0xFFFFFFFF
        values = []
        for _ in range(_N + 1):
            state = (69069 * state + 1) & 0xFFFFFFFF
            values.append(state)
        self._mt = values[1:]
        self._mti = _N  # FixupSeeds(): dummy[0] = 624 on initial seeding
        if not any(self._mt):
            raise ValueError("Degenerate Mersenne-Twister state.")
        self._gamma_cache: dict = {}

    def _genrand(self) -> float:
        mt = self._mt
        if self._mti >= _N:
            for kk in range(_N - _M):
                y = (mt[kk] & _UPPER) | (mt[kk + 1] & _LOWER)
                mt[kk] = mt[kk + _M] ^ (y >> 1) ^ (_MATRIX_A if y & 1 else 0)
            for kk in range(_N - _M, _N - 1):
                y = (mt[kk] & _UPPER) | (mt[kk + 1] & _LOWER)
                mt[kk] = mt[kk + (_M - _N)] ^ (y >> 1) ^ (_MATRIX_A if y & 1 else 0)
            y = (mt[_N - 1] & _UPPER) | (mt[0] & _LOWER)
            mt[_N - 1] = mt[_M - 1] ^ (y >> 1) ^ (_MATRIX_A if y & 1 else 0)
            self._mti = 0
        y = mt[self._mti]
        self._mti += 1
        y ^= y >> 11
        y ^= (y << 7) & 0x9D2C5680
        y ^= (y << 15) & 0xEFC60000
        y ^= y >> 18
        return y * 2.3283064365386963e-10

    def unif_rand(self) -> float:
        x = self._genrand()
        if x <= 0.0:
            return 0.5 * _I2_32M1
        if 1.0 - x <= 0.0:
            return 1.0 - 0.5 * _I2_32M1
        return x

    def norm_rand(self) -> float:
        u = self.unif_rand()
        u = int(_BIG * u) + self.unif_rand()
        return qnorm(u / _BIG)

    def exp_rand(self) -> float:
        q = _EXP_Q
        a = 0.0
        u = self.unif_rand()
        while u <= 0.0 or u >= 1.0:
            u = self.unif_rand()
        while True:
            u += u
            if u > 1.0:
                break
            a += q[0]
        u -= 1.0
        if u <= q[0]:
            return a + u
        i = 0
        ustar = self.unif_rand()
        umin = ustar
        while True:
            ustar = self.unif_rand()
            if umin > ustar:
                umin = ustar
            i += 1
            if not u > q[i]:
                break
        return a + umin * q[0]

    def gamma_rand(self, a: float, scale: float) -> float:
        """rgamma.c, GD algorithm (Ahrens and Dieter 1982) for shape a >= 1."""
        if not (math.isfinite(a) and math.isfinite(scale)) or a < 1.0 or scale <= 0.0:
            raise ValueError("The R-compatible Gamma generator needs a finite shape of at least 1 and a positive scale.")
        c = self._gamma_cache.get(a)
        if c is None:
            s2 = a - 0.5
            s = math.sqrt(s2)
            d = 5.656854 - s * 12.0
            r = 1.0 / a
            q0 = ((((((2.424e-4 * r + 2.4511e-4) * r + -7.388e-5) * r + 0.00144121) * r + 0.00801191) * r
                   + 0.02083148) * r + 0.04166669) * r
            if a <= 3.686:
                b, si, cc = 0.463 + s + 0.178 * s2, 1.235, 0.195 / s - 0.079 + 0.16 * s
            elif a <= 13.022:
                b, si, cc = 1.654 + 0.0076 * s2, 1.68 / s + 0.275, 0.062 / s + 0.024
            else:
                b, si, cc = 1.77, 0.75, 0.1515 / s
            c = self._gamma_cache[a] = (s2, s, d, q0, b, si, cc)
        s2, s, d, q0, b, si, cc = c

        t = self.norm_rand()
        x = s + 0.5 * t
        ret_val = x * x
        if t >= 0.0:
            return scale * ret_val
        u = self.unif_rand()
        if d * u <= t * t * t:
            return scale * ret_val
        if x > 0.0:
            v = t / (s + s)
            q = _gd_quotient(v, t, s, s2, q0)
            if math.log(1.0 - u) <= q:
                return scale * ret_val
        while True:
            e = self.exp_rand()
            u = self.unif_rand()
            u = u + u - 1.0
            t = b - si * e if u < 0.0 else b + si * e
            if t >= -0.71874483771719:
                v = t / (s + s)
                q = _gd_quotient(v, t, s, s2, q0)
                if q > 0.0:
                    w = math.expm1(q)
                    if cc * abs(u) <= w * math.exp(e - 0.5 * t * t):
                        break
        x = s + 0.5 * t
        return scale * x * x

    def rgamma(self, n: int, shape: float, rate: float) -> list[float]:
        scale = 1 / rate  # R: rgamma(n, shape, rate = 1, scale = 1/rate)
        return [self.gamma_rand(shape, scale) for _ in range(n)]

    def rnorm(self, n: int, mean: float = 0.0, sd: float = 1.0) -> list[float]:
        return [mean + sd * self.norm_rand() for _ in range(n)]


_EXP_Q = (0.6931471805599453, 0.9333736875190459, 0.9888777961838675, 0.9984959252914960040,
          0.9998292811061389, 0.9999833164100727, 0.9999985508193279, 0.9999998906925558,
          0.9999999924734159, 0.9999999995283275, 0.9999999999728814, 0.9999999999985598,
          0.9999999999999289, 0.9999999999999968, 0.9999999999999999, 1.0000000000000000)


def _gd_quotient(v: float, t: float, s: float, s2: float, q0: float) -> float:
    if abs(v) <= 0.25:
        return q0 + 0.5 * t * t * ((((((0.1233795 * v + -0.1367177) * v + 0.1423657) * v + -0.1662921) * v
                                      + 0.2000062) * v + -0.250003) * v + 0.3333333) * v
    return q0 - s * t + 0.25 * t * t + (s2 + s2) * math.log(1.0 + v)


def qnorm(p: float) -> float:
    """qnorm5(p, 0, 1, lower_tail = TRUE, log_p = FALSE), Wichura's AS 241."""
    if not 0.0 < p < 1.0:
        raise ValueError("qnorm needs 0 < p < 1.")
    q = p - 0.5
    if abs(q) <= 0.425:
        r = 0.180625 - q * q
        return (q * (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r
                         + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r
                      + 133.14166789178437745) * r + 3.387132872796366608)
                / (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r
                       + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r
                    + 42.313330701600911252) * r + 1.0))
    r = math.sqrt(-math.log(1.0 - p if q > 0 else p))
    if r <= 5.0:
        r += -1.6
        val = ((((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r
                    + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r
                 + 4.6303378461565452959) * r + 1.42343711074968357734)
               / (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r
                      + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r
                   + 2.05319162663775882187) * r + 1.0))
    else:
        r += -5.0
        val = ((((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r
                    + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r
                 + 5.4637849111641143699) * r + 6.6579046435011037772)
               / (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r
                      + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r
                   + 0.59983220655588793769) * r + 1.0))
    return -val if q < 0.0 else val


def mean(values: list[float]) -> float:
    """R's mean(): extended-precision two-pass mean, here computed exactly and rounded once."""
    return float(sum(map(Fraction, values), Fraction(0)) / len(values))


def var(values: list[float]) -> float:
    """R's var(): sum of squares about the double-precision mean, divided by n - 1."""
    centre = Fraction(mean(values))
    return float(sum(((Fraction(v) - centre) ** 2 for v in values), Fraction(0)) / (len(values) - 1))


def sd(values: list[float]) -> float:
    return math.sqrt(var(values))


def _neg_log_likelihood(values: list[float], shape: float, rate: float) -> float:
    """-sum(dgamma(x, shape, rate, log = TRUE)); NaN where R returns NaN."""
    if not (shape > 0 and rate > 0):
        return math.nan
    scale = 1 / rate  # R: dgamma(x, shape, rate = 1, scale = 1/rate)
    log_scale, log_gamma = math.log(scale), math.lgamma(shape)
    terms = []
    for x in values:
        y = x / scale
        terms.append((shape - 1) * math.log(y) - y - log_gamma - log_scale)
    return -math.fsum(terms)


def fitdistr_gamma(values: list[float]) -> dict:
    """MASS::fitdistr(x, "gamma"): moment start, optim(method = "BFGS", parscale = c(1, rate0)).

    Numerical gradient as optim() without gr: central differences, ndeps = 1e-3 on
    the scaled parameters. reltol = sqrt(.Machine$double.eps), abstol = -Inf, maxit = 100.
    """
    if len(values) < 2 or any(not math.isfinite(x) or x <= 0 for x in values):
        raise ValueError("Gamma fitting requires positive finite seasonal rainfall.")
    m, v = mean(values), var(values)
    if not v > 0:
        raise ValueError("A Gamma fit requires variation in seasonal totals.")
    start = [m * m / v, m / v]
    parscale = [1.0, start[1]]

    def fn(p):
        return _neg_log_likelihood(values, p[0] * parscale[0], p[1] * parscale[1])

    def gr(p):
        grad = []
        for i in range(2):
            x = list(p)
            x[i] = p[i] + 1e-3
            up = fn(x)
            x[i] = p[i] - 1e-3
            down = fn(x)
            g = (up - down) / (2 * 1e-3)
            if not math.isfinite(g):
                raise ValueError("Non-finite finite-difference value in the Gamma fit.")
            grad.append(g)
        return grad

    b = [start[0] / parscale[0], start[1] / parscale[1]]
    best, counts, iterations = _vmmin(b, fn, gr, maxit=100, reltol=1.4901161193847656e-08)
    shape, rate = b[0] * parscale[0], b[1] * parscale[1]
    return {"shape": shape, "rate": rate, "logLikelihood": -best, "start": {"shape": start[0], "rate": start[1]},
            "functionCount": counts[0], "gradientCount": counts[1], "iterations": iterations}


def _vmmin(b: list[float], fn, gr, *, maxit: int, reltol: float, abstol: float = -math.inf):
    """optim.c vmmin(): variable metric (BFGS) minimiser with R's line search. Updates b in place."""
    stepredn, acctol, reltest = 0.2, 0.0001, 10.0
    n = len(b)
    f = fn(b)
    if not math.isfinite(f):
        raise ValueError("Initial value in the Gamma fit is not finite.")
    fmin = f
    funcount = gradcount = 1
    g = gr(b)
    iteration = 1
    ilast = gradcount
    B = [[0.0] * n for _ in range(n)]
    t, X, c = [0.0] * n, [0.0] * n, [0.0] * n
    count = 0
    while True:
        if ilast == gradcount:
            for i in range(n):
                for j in range(i):
                    B[i][j] = 0.0
                B[i][i] = 1.0
        for i in range(n):
            X[i], c[i] = b[i], g[i]
        gradproj = 0.0
        for i in range(n):
            s = 0.0
            for j in range(i + 1):
                s -= B[i][j] * g[j]
            for j in range(i + 1, n):
                s -= B[j][i] * g[j]
            t[i] = s
            gradproj += s * g[i]
        if gradproj < 0.0:
            steplength = 1.0
            accpoint = False
            while True:
                count = 0
                for i in range(n):
                    b[i] = X[i] + steplength * t[i]
                    if reltest + X[i] == reltest + b[i]:
                        count += 1
                if count < n:
                    f = fn(b)
                    funcount += 1
                    accpoint = math.isfinite(f) and f <= fmin + gradproj * steplength * acctol
                    if not accpoint:
                        steplength *= stepredn
                if count == n or accpoint:
                    break
            enough = f > abstol and abs(f - fmin) > reltol * (abs(fmin) + reltol)
            if not enough:
                count = n
                fmin = f
            if count < n:
                fmin = f
                g = gr(b)
                gradcount += 1
                iteration += 1
                D1 = 0.0
                for i in range(n):
                    t[i] = steplength * t[i]
                    c[i] = g[i] - c[i]
                    D1 += t[i] * c[i]
                if D1 > 0:
                    D2 = 0.0
                    for i in range(n):
                        s = 0.0
                        for j in range(i + 1):
                            s += B[i][j] * c[j]
                        for j in range(i + 1, n):
                            s += B[j][i] * c[j]
                        X[i] = s
                        D2 += s * c[i]
                    D2 = 1.0 + D2 / D1
                    for i in range(n):
                        for j in range(i + 1):
                            B[i][j] += (D2 * t[i] * t[j] - X[i] * t[j] - t[i] * X[j]) / D1
                else:
                    ilast = gradcount
            else:
                if ilast < gradcount:
                    count = 0
                    ilast = gradcount
        else:
            count = 0
            if ilast == gradcount:
                count = n
            else:
                ilast = gradcount
        if iteration >= maxit:
            raise ValueError("The Gamma fit did not converge within R's default iteration limit.")
        if gradcount - ilast > 2 * n:
            ilast = gradcount
        if count == n and ilast == gradcount:
            break
    return fmin, (funcount, gradcount), iteration

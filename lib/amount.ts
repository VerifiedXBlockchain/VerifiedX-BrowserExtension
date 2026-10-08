// Strict parsing for user-entered and server-supplied coin amounts.
//
// parseFloat accepts "1,5" as 1 and "1.2.3" as 1.2, so a locale-formatted
// entry silently becomes a different amount. Amounts here must be plain
// digits with an optional "." and at most AMOUNT_DECIMALS fraction digits.

export const AMOUNT_DECIMALS = 8

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/

// The project compiles without strictNullChecks, which disables narrowing on
// a boolean discriminant, so this is one shape rather than a union.
export interface ParsedAmount {
    ok: boolean
    units?: bigint
    value?: number
    display?: string
    error?: string
}

export function parseAmount(input: string, decimals: number = AMOUNT_DECIMALS): ParsedAmount {
    const text = input.trim()

    if (text === "") {
        return { ok: false, error: "Enter an amount" }
    }

    if (text.includes(",")) {
        return { ok: false, error: "Use a period (.) for decimals, with no thousands separators" }
    }

    const match = AMOUNT_PATTERN.exec(text)
    if (!match) {
        return { ok: false, error: "Enter a number like 1.5" }
    }

    const whole = match[1] ?? "0"
    const fraction = match[2] ?? match[3] ?? ""

    if (fraction.length > decimals) {
        return { ok: false, error: `Use at most ${decimals} decimal places` }
    }

    const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")

    if (units === 0n) {
        return { ok: false, error: "Amount must be greater than zero" }
    }

    const display = formatUnits(units, decimals)
    return { ok: true, units, value: Number(display), display }
}

export function formatUnits(units: bigint, decimals: number = AMOUNT_DECIMALS): string {
    const base = 10n ** BigInt(decimals)
    const whole = units / base
    const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "")
    return fraction ? `${whole}.${fraction}` : whole.toString()
}

// Converts a number the app already holds (a balance, a fee estimate) to
// units for comparison. Rounds to the nearest unit.
export function numberToUnits(value: number, decimals: number = AMOUNT_DECIMALS): bigint {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Not a valid amount: ${value}`)
    }
    return BigInt(Math.round(value * 10 ** decimals))
}

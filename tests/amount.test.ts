import { describe, expect, it } from "vitest"

import { formatUnits, numberToUnits, parseAmount } from "~lib/amount"

describe("parseAmount", () => {
    it.each([
        ["1", 100000000n, "1"],
        ["1.5", 150000000n, "1.5"],
        ["0.00000001", 1n, "0.00000001"],
        [".5", 50000000n, "0.5"],
        ["2.", 200000000n, "2"],
        [" 12.34 ", 1234000000n, "12.34"],
        ["007.10", 710000000n, "7.1"]
    ])("accepts %j", (input, units, display) => {
        const parsed = parseAmount(input)
        expect(parsed).toMatchObject({ ok: true, units, display })
    })

    it.each([
        ["1,5", "period"],
        ["1.234,56", "period"],
        ["1,000", "period"],
        ["1.2.3", "number"],
        ["1e5", "number"],
        ["-1", "number"],
        ["+1", "number"],
        ["abc", "number"],
        ["1 000", "number"],
        ["0x10", "number"],
        ["Infinity", "number"],
        ["0.000000001", "decimal places"],
        ["0", "greater than zero"],
        ["0.00000000", "greater than zero"],
        ["", "Enter an amount"]
    ])("rejects %j", (input, message) => {
        const parsed = parseAmount(input)
        expect(parsed.ok).toBe(false)
        if (!parsed.ok) expect(parsed.error).toContain(message)
    })

    it("does not lose precision on large amounts", () => {
        const parsed = parseAmount("92233720.36854775")
        expect(parsed).toMatchObject({ ok: true, units: 9223372036854775n })
    })
})

describe("formatUnits", () => {
    it("trims trailing zeros", () => {
        expect(formatUnits(100000000n)).toBe("1")
        expect(formatUnits(123456789n)).toBe("1.23456789")
        expect(formatUnits(1n)).toBe("0.00000001")
    })
})

describe("numberToUnits", () => {
    it("rounds float noise to the nearest unit", () => {
        expect(numberToUnits(0.1 + 0.2)).toBe(30000000n)
        expect(numberToUnits(12.5)).toBe(1250000000n)
    })

    it("rejects negative and non-finite values", () => {
        expect(() => numberToUnits(-1)).toThrow()
        expect(() => numberToUnits(NaN)).toThrow()
    })
})

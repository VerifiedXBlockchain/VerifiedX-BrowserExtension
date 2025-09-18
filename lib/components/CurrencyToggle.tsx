import { Currency } from "~types/types"

interface CurrencyToggleProps {
  currency: Currency
  onCurrencyChange: (currency: Currency) => void
}

function CurrencyToggle({ currency, onCurrencyChange }: CurrencyToggleProps) {
  return (
    <div className="flex bg-gray-800 rounded-lg p-1">
      <button
        onClick={() => onCurrencyChange(Currency.VFX)}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          currency === Currency.VFX
            ? "bg-blue-600 text-white"
            : "text-gray-300 hover:text-white"
        }`}
      >
        VFX
      </button>
      <button
        onClick={() => onCurrencyChange(Currency.BTC)}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
          currency === Currency.BTC
            ? "bg-orange-600 text-white"
            : "text-gray-300 hover:text-white"
        }`}
      >
        BTC
      </button>
    </div>
  )
}

export default CurrencyToggle
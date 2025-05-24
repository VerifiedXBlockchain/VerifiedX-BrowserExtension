import { useState } from "react"

export function useToast(duration = 3000) {
    const [message, setMessage] = useState<string | null>(null)

    const showToast = (msg: string) => {
        setMessage(msg)
        setTimeout(() => setMessage(null), duration)
    }

    return { message, showToast }
}
interface ToastProps {
    message: string | null
}

export default function Toast({ message }: ToastProps) {
    if (!message) return null

    return (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded shadow z-50 text-sm">
            {message}
        </div>
    )
}

import Foundation

/// Subscription limits as returned by the Mac server's /usage endpoint.
struct Usage: Decodable {
    struct Window: Decodable {
        let usedPercent: Double
        let resetsAt: String?

        var resetDate: Date? {
            resetsAt.flatMap { Self.formatter.date(from: $0) }
        }

        private static let formatter: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()
    }

    let session: Window?
    let weekly: Window?
}

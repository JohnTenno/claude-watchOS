import Foundation

struct ConversationSummary: Identifiable, Decodable, Hashable {
    let id: String
    let title: String
    let updatedAt: String
}

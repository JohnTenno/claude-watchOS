import Foundation
import Observation

@MainActor
@Observable
final class ConversationListViewModel {
    private(set) var conversations: [ConversationSummary] = []
    private(set) var usage: Usage?
    private(set) var errorText: String?
    private let service: ChatService

    init(service: ChatService = ChatService()) {
        self.service = service
    }

    func refresh() async {
        do {
            async let conversations = service.conversations()
            async let usage = service.usage()
            self.conversations = try await conversations
            self.usage = try? await usage
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

import Foundation
import Observation

@MainActor
@Observable
final class ConversationListViewModel {
    private(set) var conversations: [ConversationSummary] = []
    private(set) var usage: Usage?
    private(set) var usageUnavailable = false
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
            // Keeps the last known usage when a refresh fails instead of hiding the gauges.
            if let fresh = try? await usage {
                self.usage = fresh
                usageUnavailable = false
            } else {
                usageUnavailable = self.usage == nil
            }
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}

import Foundation

struct Message: Identifiable, Decodable {
    enum Role: String, Decodable { case user, assistant, error }

    let id = UUID()
    let role: Role
    let text: String

    init(role: Role, text: String) {
        self.role = role
        self.text = text
    }

    private enum CodingKeys: String, CodingKey { case role, text }
}

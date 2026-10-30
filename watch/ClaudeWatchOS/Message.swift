import Foundation

struct Message: Identifiable, Decodable {
    enum Role: String, Decodable { case user, assistant, error }

    let id = UUID()
    let role: Role
    let text: String
    /// JPEG attached on this watch; history from the server only keeps a 📷 marker in the text.
    var image: Data?

    init(role: Role, text: String, image: Data? = nil) {
        self.role = role
        self.text = text
        self.image = image
    }

    private enum CodingKeys: String, CodingKey { case role, text }
}

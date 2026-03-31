# Chrome Web Store Program Policies (fetched 2026-03-31)

## Core Principles
- **Be Safe**: Remove extensions posing security threats or abuse
- **Be Honest**: High transparency standards; remove deceptive extensions
- **Be Useful**: Extensions must provide educational, informative value

---

## Best Practices and Guidelines

1. Research and understand the Chrome Web Store policies before developing.
2. Extensions should provide meaningful utility or unique features.
3. No deceptive practices — scamming the system (misleading users, circumventing enforcement, copying other developers, manipulating reviews/ratings) results in ban.
4. Adhere to strict data collection and disclosure guidelines, obtain proper user consent, comply with additional policies for sensitive information access.
5. Maintain current and accurate extension information and metadata in the developer dashboard.
6. Test extensions thoroughly for crashes, broken features, and bugs before submission.
7. Verify contact details to receive important Chrome Web Store communications.
8. Provide detailed single-purpose field information about primary functionality.
9. Offer meaningful customer support for your extension.
10. Stay informed of policy updates announced via email to your developer account.

---

## Use of Permissions

Request access to the narrowest permissions necessary to implement your Product's features or services. If more than one permission could be used to implement a feature, you must request those with the least access to data or functionality. Don't attempt to "future proof" your Product by requesting a permission that might benefit services or features that have not yet been implemented.

---

## Code Readability Requirements

Developers must not obfuscate code or conceal the functionality of their extension. This restriction extends to any external code or resources that the extension package retrieves.

**Permitted minification:**
- Whitespace and comment removal
- Variable and function name shortening
- File consolidation (bundling)

---

## API Use

Extensions must use existing Chrome APIs for their designated use case. Use of any other method, for which an API exists, would be considered a violation.

Example: overriding the Chrome New Tab Page through any means other than the URL Overrides API is not permitted.

---

## Privacy Policy Requirements

1. Extensions handling user data must post an accurate, current privacy policy.
2. The policy must disclose:
   - How your Product collects, uses and shares user data
   - All parties the user data will be shared with
3. Policy must be linked in the Chrome Web Store Developer Dashboard.

---

## Data Handling Requirements

1. **Secure Data Handling**: If your product collects any user data, it must handle the user data securely, including transmitting it via modern cryptography.
2. **Financial Data**: Don't publicly disclose financial or payment information.
3. **Authentication Security**: Keep authentication information secure. Don't publicly disclose authentication information.
4. **Vulnerability Management**: Products associated with exploitable security flaws affecting other applications, services, browsers, or systems may face removal.

---

## Quality Guidelines

### Rule 1: Single, Narrow Purpose
Extensions must have a single purpose that is narrow and easy to understand. Users should not be forced to accept bundled unrelated functionality.

**Common violations:**
- Product ratings displays combined with ad injection
- Toolbars offering broad functionality better split into separate extensions
- Email notifiers bundled with news aggregators
- New Tab Page extensions that alter search without respecting user settings

### Rule 2: Complementary Functionality with Minimal Distraction
Extensions should function as a helpful companion to users' browsing experiences through complementary features. Persistent UI elements must actively enhance current tasks while minimizing interruptions.

**Common violations:**
- Side panels that hijack browsing or search experiences
- Extensions primarily designed to serve advertisements

---

## Listing Requirements

1. **Required Fields**: Extensions must include all mandatory fields. Blank description, missing icon, or missing screenshots will face rejection.
2. **Accurate and Current Information**: Ensure your product's listing information is up to date, accurate, and comprehensive.
3. **Privacy Field Compliance**: All privacy-related fields must remain current and truthful.
4. **Keyword Spam Prevention**: Irrelevant or excessive keyword inclusion designed to manipulate rankings is not allowed. Repeating identical keywords more than 5 times unnaturally is prohibited.
5. **User Testimonials**: Unattributed or anonymous user testimonials within product descriptions are prohibited.

---

## Manifest V3 Requirements

The full functionality of an extension must be easily discernible from its submitted code, unless otherwise exempt.

**Prohibited:**
- `<script>` tags pointing to resources outside the extension package
- Using `eval()` or similar mechanisms to execute remote strings
- Building interpreters to run commands fetched from remote sources

**Permitted remote execution (exemptions):**
- Debugger API
- User Scripts API

**Isolated context exemption:**
Code in isolated contexts (iframes, sandboxed pages) may load remote code but must comply with user data policies, Limited Use restrictions, and the extension's Privacy Policy.

**Permitted remote communications:**
- Syncing user account data
- Fetching configuration files for A/B testing (logic must be local)
- Loading non-logic resources (images, etc.)
- Server-side operations (encryption with private keys)

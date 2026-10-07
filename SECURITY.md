# Security and privacy

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option when private vulnerability reporting is enabled. If the option is unavailable, request a private reporting channel through an issue without including exploit details or private documents.

Describe the version, affected feature, and a minimal reproduction using synthetic documents. Do not attach your Zotero database, private PDFs, raw OCR cache, full job folders, or unredacted diagnostic logs to a public issue. Logs can contain item titles, filenames, item keys, URLs, and extracted document text. Review them before sharing.

## Data flow

The Zotero recognizer sends extracted text from the first PDF pages to Zotero's service; see [Zotero's description](https://www.zotero.org/support/retrieve_pdf_metadata). Identifier and catalogue lookup can disclose DOI/ISBN, titles and query fragments to the selected providers. Browser search can execute website scripts and use Zotero's browser cookie context.

LM Studio page images are sent to a loopback server configured by the user. The add-on rejects non-loopback endpoints and URL credentials. Other software able to access that local server or the user's data directory remains outside the add-on's access boundary.

Automated external page requests and in-plugin browser navigation reject non-HTTP(S) schemes, URL credentials, control characters, localhost names and known private/loopback IPv4 or IPv6 literals. Manual redirect resolution checks each Location before following it. Automatic HTTP/browser redirects are checked after arrival; this does not prevent the transport from already contacting that destination. DNS names can resolve to private addresses or change their answers, and webpage subrequests are controlled by Zotero's browser. Links opened by the user in an external browser are checked for scheme, credentials and control characters, but may point to local addresses. These checks are input safeguards, not a complete network isolation mechanism. The local LM Studio path keeps its separate loopback policy.

When a Korean web translator is missing, the add-on can fetch it from an immutable Git revision and install it in Zotero's translator directory. Translator identity and type are checked, and existing files are not overwritten. A pinned revision reduces update drift; it does not replace a review of the upstream translator code.

There is no separate analytics collector in this add-on's source. This statement does not describe the policies of Zotero or the external services it uses.

## Local records

The following folders under the Zotero data directory may contain private bibliographic data or document excerpts:

- `pdf-metadata-refresh-cache`: cached recognition results.
- `pdf-metadata-refresh-jobs`: saved jobs, user decisions, apply history and reports.
- `pdf-metadata-refresh-ocr`: OCR/model results and temporary page rendering.

The local data is stored as ordinary files with the operating system's permissions. It is not encrypted by this add-on. Quit Zotero before manually moving or removing these folders. Removing jobs also removes the add-on's retained decisions and history; keep backups when you need them.

## Build and repository boundaries

Only explicitly reviewed files are permitted in the public source export. The public repository contains reviewed release source, release notes, synthetic tests and screenshots of fictional documents. Historical development notes, real library test fixtures, PDFs, databases, audit folders, temporary files, previous XPIs and dependencies are excluded. Public JPEGs are checked for embedded metadata and thumbnails.

The release checker scans known token formats, private keys, local account paths and credentials in URLs. It prints file/line/type instead of any matching value. This is a bounded preflight check; it does not prove the absence of secrets. Enable GitHub push protection and examine the exported tree before committing. GitHub's [secret scanning documentation](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) explains repository history coverage and credential revocation.

XPI packaging uses an exact entry allowlist. Release builds omit source maps and source comments. CI has read-only repository permissions, does not persist checkout credentials, uses full action commit hashes, and performs dependency auditing. These follow GitHub's [secure Actions guidance](https://docs.github.com/en/actions/reference/security/secure-use).

# Data and privacy — version 1.0.0

The repository's screenshots show a fictional demo library. Document titles, authors, dates, catalogue records, item keys and example identifiers were written for the demonstration. No screenshot was taken from a personal Zotero library. Image assets omit personal paths, account names, browser tabs and embedded image metadata.

## Requests made while finding information

| Feature | Information involved | Destination |
| --- | --- | --- |
| Zotero PDF recognition | Extracted text from the first PDF pages | Zotero's recognition service |
| Identifier and catalogue lookup | Identifiers such as DOI/ISBN, titles or search fragments | The selected bibliographic provider or website |
| Browser search | Query text and requests needed to open search results | External websites, using Zotero's browser context |
| LM Studio vision reading | Images of the selected PDF pages | The configured loopback server on this computer |
| Missing Korean translators | Download of a translator from a pinned upstream revision | The upstream source; installed in Zotero's translator directory |

Zotero describes its own PDF recognition in [Retrieve PDF Metadata](https://www.zotero.org/support/retrieve_pdf_metadata). External providers have their own policies. Website scripts may execute and Zotero's browser cookies may be used. Local LM Studio reading is optional; enabling other lookup methods can still make external requests.

There is no separate analytics collector in this plugin's source. This statement does not cover Zotero, LM Studio or the websites used by the workflow.

## Records kept on this computer

Under the Zotero data directory, the plugin uses:

- `pdf-metadata-refresh-cache` for cached recognition results.
- `pdf-metadata-refresh-jobs` for saved work, user choices, reports and apply/undo history.
- `pdf-metadata-refresh-ocr` for model results and temporary page rendering.

These records can contain titles, document excerpts, item keys, filenames and URLs. The plugin stores ordinary files; it does not add encryption. Other software with access to the data directory or local model server is outside this plugin's access boundary.

Quit Zotero before manually moving these folders. Removing job records also removes retained decisions and recovery history. Keep the records and backups you need before clearing them.

## Sharing reports and bug examples

Review exported reports before sharing them. Use a fictional document or a small redacted example in a public issue. Do not upload a Zotero database, private PDF, raw OCR cache, full job folder or unredacted log. See [SECURITY.md](../SECURITY.md) for private vulnerability reporting and the limits of the URL safeguards.

## 한국어 안내

저장소의 스크린샷은 가상 문서와 가상 서지정보로 만든 화면입니다. 실제 라이브러리, 계정 정보와 개인 경로를 사용하지 않았습니다.

Zotero 인식은 PDF 앞쪽의 추출 글을 Zotero 서비스로, 식별자·외부 검색은 DOI·ISBN·제목·검색어를 해당 서비스나 사이트로 보낼 수 있습니다. 웹 검색은 Zotero 브라우저의 쿠키를 사용하고 사이트 스크립트를 실행할 수 있습니다. LM Studio는 선택한 PDF 페이지 이미지를 로컬 서버로 받습니다. 로컬 이미지 판독을 사용해도 다른 검색 경로에서 외부 요청이 발생할 수 있습니다.

작업·캐시·판독 기록·복구 자료에는 제목, 문서 일부, 항목 키, 파일명과 URL이 들어갈 수 있고 플러그인이 별도 암호화하지 않습니다. 공유 전 보고서를 확인하고 개인 PDF·데이터베이스·원본 로그를 공개 이슈에 첨부하지 마세요.

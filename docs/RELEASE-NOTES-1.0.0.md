# PDF Metadata Refresh 1.0.0

First public release for reviewing the metadata of PDFs already in Zotero.

## Included

- Find metadata using Zotero recognition, printed identifiers, catalogue/website lookup and optional local LM Studio vision reading.
- Compare existing and proposed values, choose fields and apply only through an explicit action and confirmation.
- Search titles, group identical evidence tags, resize the evidence column and review changes beside the list.
- Read evidence colours consistently across the list and detailed groups, ordered grey → red → orange → yellow → blue → green.
- Continue saved jobs, review apply records, undo eligible changes and export selected items as a JSON report.
- Korean UI for Korean Zotero locales; English UI for all other locales. Document data remains unchanged by interface translation.
- A document-and-refresh icon in Zotero's Plugins window, with standard and high-density sizes.

## Install

Download `pdf-metadata-refresh-1.0.0.xpi`. In Zotero, open **Tools → Plugins** and install the XPI from file or drag it into the Plugins window.

Declared installation range: Zotero 10.0.1–10.0.x. LM Studio's PDF page rendering currently requires Windows. Synthetic checks and UI screenshots do not measure recognition accuracy or replace runtime verification with Zotero and a chosen model.

The default replacement setting can propose clearing older fields or creators absent from newly found information. Review clearing proposals and hidden selections before applying. Colour does not approve a value.

See the [User guide](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/docs/USER-GUIDE.md), [Privacy](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/docs/PRIVACY.md) and [Security](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/SECURITY.md). Screenshots use fictional documents.

## 한국어 릴리스 안내

Zotero에 이미 들어 있는 PDF의 제목·저자·발행 정보를 다시 찾아 비교하고 선택해서 적용하는 플러그인의 첫 공개 버전입니다.

- 기존 값·제안 값·비우기 제안을 항목별·필드별로 검토합니다.
- 제목 검색, 같은 근거끼리 정렬, 근거 열 너비 조절과 목록 옆 변경 비교를 제공합니다.
- 상세 분류와 목록의 근거 색을 통일하고 회색 → 빨강 → 주황 → 노랑 → 파랑 → 초록 순서로 배치합니다.
- 저장된 작업 이어보기, 적용 기록, 되돌리기와 선택한 항목의 JSON 파일 내보내기를 제공합니다.
- 한국어 환경은 한국어로, 그 외 언어 환경은 영어로 표시합니다. 문서의 값은 원문을 유지합니다.
- 일반 화면과 고해상도 화면에 맞는 아이콘을 Zotero 플러그인 목록에 제공합니다.

`pdf-metadata-refresh-1.0.0.xpi`를 내려받아 Zotero의 **도구 → 플러그인**에서 설치하세요. 설치 범위는 Zotero 10.0.1–10.0.x이며 LM Studio 페이지 이미지 생성은 Windows에서 지원합니다. 스크린샷은 가상 자료로 만들었고 개인 문서나 개발 기록은 포함하지 않았습니다.

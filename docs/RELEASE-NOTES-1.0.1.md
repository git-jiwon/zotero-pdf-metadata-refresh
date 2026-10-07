# PDF Metadata Refresh 1.0.1

Maintenance update for development dependencies and automated checks. Metadata recognition, field decisions, application and undo behaviour are preserved.

## Updated tooling

| Tool | Previous | Updated |
| --- | --- | --- |
| TypeScript | 5.9.3 | 7.0.2 |
| esbuild | 0.25.12 | 0.28.2 |
| Archiver | 7.0.1 | 8.0.0 |
| Node.js type definitions | 22.20.1 | 26.6.4 |
| actions/checkout | 4.3.1 | 7.0.1 |
| actions/setup-node | 4.4.0 | 7.0.0 |

The type checker uses TypeScript 7. Source-export and localisation checks use Microsoft's official TypeScript 6 API compatibility package. ZIP packaging uses Archiver 8's current API. GitHub Actions remain pinned to full commit hashes with read-only permissions; the build runtime remains Node.js 24.

## Install or update

Download **pdf-metadata-refresh-1.0.1.xpi** from this release and install it through **Zotero → Tools → Plugins**. The add-on ID and installation range remain the same: **Zotero 10.0.1–10.0.x**. Existing installations can also obtain 1.0.1 through Zotero's add-on update check after the update manifest is available.

The release includes the installable XPI and a reviewed source ZIP. Version 1.0.0 remains available in the release history. See the [user guide](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/docs/USER-GUIDE.md), [privacy information](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/docs/PRIVACY.md) and [security policy](https://github.com/git-jiwon/zotero-pdf-metadata-refresh/blob/main/SECURITY.md).

## 한국어 릴리스 안내

개발 도구와 GitHub 자동 검사 도구를 최신 안정 버전으로 갱신한 유지보수 업데이트입니다. 인식 알고리즘과 항목·필드 선택, 적용·되돌리기 동작은 유지합니다.

- TypeScript 7, esbuild 0.28.2, Archiver 8과 최신 Node.js 타입 정의를 적용했습니다.
- 공개 소스 생성과 언어 검사에는 Microsoft의 공식 TypeScript 6 API 호환 패키지를 사용합니다.
- checkout·setup-node를 갱신하고 전체 커밋 해시 고정 및 읽기 전용 권한을 유지했습니다.
- 압축 도구의 새 API에 맞춰 설치 파일을 생성하고, 업데이트 체크섬을 갱신했습니다.

**pdf-metadata-refresh-1.0.1.xpi**를 내려받아 **Zotero → 도구 → 플러그인**에서 설치하세요. 기존 설치의 플러그인 업데이트 확인에서도 새 버전을 받을 수 있습니다. 호환 범위는 Zotero 10.0.1–10.0.x이며, 기존 1.0.0 릴리스는 보존합니다.

# GitHub publishing information — 1.0.0

## Repository information

- Owner: `git-jiwon`
- Repository: `zotero-pdf-metadata-refresh`
- Default branch: `main`
- Version and tag: `1.0.0` / `v1.0.0`
- Release title: `PDF Metadata Refresh 1.0.0`

**About description — English**

Review and refresh Zotero PDF metadata with field-by-field comparison, evidence grouping, apply/undo history, and Korean or English UI.

**소개 문구 — 한국어**

Zotero PDF의 서지정보를 다시 찾아 필드별로 비교·적용하는 플러그인. 근거 색 구분, 작업 복구, 한국어·영어 UI를 제공합니다.

**Topics**

`zotero` `zotero-plugin` `pdf` `metadata` `bibliography` `ocr` `lm-studio` `typescript`

## Upload scope

Publish the reviewed 1.0.0 source export. Its root README is the English introduction; `docs/README.ko.md` is the Korean introduction. The user guides, privacy and security information, release notes and synthetic screenshots are included.

Keep the local `development-history` directory out of GitHub. It contains prior builds, real-library development tests, audit records, old notes and temporary material. Do not upload the whole development working folder, `node_modules`, caches or unreviewed images.

Attach `pdf-metadata-refresh-1.0.0.xpi` to the release. Use [RELEASE-NOTES-1.0.0.md](RELEASE-NOTES-1.0.0.md) as its release body. The source ZIP, if attached, must be generated from the exact reviewed source allowlist. Do not attach prior versions.

The manifest uses `https://raw.githubusercontent.com/git-jiwon/zotero-pdf-metadata-refresh/main/updates.json`. The update JSON must use the same add-on ID, version and compatibility range as the manifest, point to the 1.0.0 release asset and include its actual SHA-256.

## Verification before publishing

```sh
npm ci --ignore-scripts
npm run typecheck
npm run test:public
npm audit --audit-level=moderate
npm run build:release
npm run release:check
```

Build first, then create or update `updates.json` with the final XPI checksum before the strict release check. Check the source file list and fictional screenshots, select the distribution license, and verify the workflow in a separate Zotero library. A successful synthetic test does not establish live recognition accuracy.

Use a commit identity with a public GitHub handle and a GitHub no-reply email. Review the files actually staged with `git diff --cached --name-only` before pushing. Keep a single initial public history for this 1.0.0 release; private development history does not belong in the new repository.

## 한국어 업로드 안내

GitHub에는 검토된 **1.0.0 공개 폴더**만 올립니다. 영어 README와 한국어 README, 사용 안내, 개인정보·보안 안내, 릴리스 글과 가상 스크린샷이 들어 있습니다.

로컬 `development-history`는 이전 개발 자료의 보관 위치입니다. 이 폴더나 개발 작업 폴더 전체를 GitHub에 올리지 마세요. Release에는 `pdf-metadata-refresh-1.0.0.xpi`를 첨부하고 이 버전의 릴리스 안내만 사용합니다. `updates.json`은 최종 XPI의 실제 SHA-256과 같은 버전·호환 범위를 사용해야 합니다.

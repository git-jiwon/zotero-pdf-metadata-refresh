/**
 * Synthetic policy tests: five document types, each with a case that should
 * write and one that should not.
 *
 * WHAT THESE MEASURE. The decision path, end to end — page text, identifier
 * scan, candidate, judgement, write plan, and the write itself against an item
 * that records what was set. Nothing here injects `verified: true`: a field is
 * writable only because a rule found its value in the page, or because an
 * approval names it.
 *
 * WHAT THESE DO NOT MEASURE. The pages are strings written by hand and the
 * candidates are objects written by hand. No PDF is opened, no text is
 * extracted, no provider is called. They say nothing about how often extraction
 * succeeds or how often a lookup returns the right record, and no accuracy
 * figure may be taken from them. The file was called "golden" for a while,
 * which claimed exactly the thing it cannot support.
 *
 * The negative cases are written against the hard shape: a value that IS on the
 * page, in a different role or a different edition. Removing a value from the
 * page and checking that it is not found tests very little.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPolicy, makeRunner, snapshotOf } from './support/policy-harness.mjs';

const policy = await loadPolicy();
const { identityFromIdentifier, POLICY } = policy;
const run = makeRunner(policy);
const scopeless = value => JSON.parse(JSON.stringify(value));

// ===========================================================================
// 1. 논문 — a journal article that prints its own DOI
// ===========================================================================

const ARTICLE_PAGE = [
  'Nanoscale',
  'PAPER',
  'Cite this: Nanoscale, 2020, 12, 1234',
  'Thermal transport in nanoscale silicon devices',
  'Jae-Hyun Kim, Miriam Vogel and Lukas Braun',
  'DOI: 10.1039/d0nr02967j, pages 1234-1245, received 2020',
  'Abstract Heat flow in silicon devices at the nanoscale is governed by boundary scattering.',
  'References',
  '1. R. Prasher, Nano Lett., 2005, 5, 2155. DOI: 10.1021/nl051106u'
].join('\n');

test('논문 · positive — the page states it, so the page corroborates it and it is written', async () => {
  const before = snapshotOf('journalArticle', { title: 'Thermal transport in nanoscale devices' }, []);
  const candidate = snapshotOf('journalArticle', {
    title: 'Thermal transport in nanoscale silicon devices',
    publicationTitle: 'Nanoscale', date: '2020', volume: '12', pages: '1234-1245', DOI: '10.1039/d0nr02967j'
  }, [{ firstName: 'Jae-Hyun', lastName: 'Kim' }, { firstName: 'Miriam', lastName: 'Vogel' }, { firstName: 'Lukas', lastName: 'Braun' }]);
  const identity = identityFromIdentifier({ kind: 'DOI', value: '10.1039/d0nr02967j' }, candidate, 'printedInDocument', POLICY, ARTICLE_PAGE);

  const result = await run({ page: ARTICLE_PAGE, candidate, before, identity });

  // The reference list's DOI was not read as the document's own — it is kept apart as a cited work's (쪽 구조의 references 영역; 옛
  // beforeReferences는 목록을 읽지 않았다).
  assert.deepEqual(result.scan.observations.filter(e => e.kind === 'DOI' && !e.cited).map(e => e.value), ['10.1039/d0nr02967j']);
  assert.deepEqual(result.scan.observations.filter(e => e.kind === 'DOI' && e.cited).map(e => e.value), ['10.1021/nl051106u']);
  assert.equal(result.levels.title, 'verified');
  assert.equal(result.levels.DOI, 'verified');
  assert.equal(result.levels.creators, 'verified');
  assert.equal(result.levels.pages, 'verified');
  assert.equal(result.error, null);
  // And the write actually happened, field by field.
  assert.equal(result.written.fields.title, 'Thermal transport in nanoscale silicon devices');
  assert.equal(result.written.fields.DOI, '10.1039/d0nr02967j');
  assert.equal(result.written.fields.publicationTitle, 'Nanoscale');
  assert.equal(result.written.saves, 1);
});

test('논문 · negative — a record that is right about the work and wrong about its authors writes only what the page backs', async () => {
  // Same surnames as the by-line, different given names — the shape a wrong
  // Crossref record actually takes when two people share a family name.
  const before = snapshotOf('journalArticle', { title: 'Thermal transport in nanoscale devices', date: '2020' }, []);
  const candidate = snapshotOf('journalArticle', {
    title: 'Thermal transport in nanoscale silicon devices',
    publicationTitle: 'Nanoscale', date: '2016', volume: '9', pages: '1234-1245', DOI: '10.1039/d0nr02967j'
  }, [{ firstName: 'Sang-Woo', lastName: 'Kim' }, { firstName: 'Anna', lastName: 'Vogel' }, { firstName: 'Peter', lastName: 'Braun' }]);
  const identity = identityFromIdentifier({ kind: 'DOI', value: '10.1039/d0nr02967j' }, candidate, 'printedInDocument', POLICY, ARTICLE_PAGE);

  const result = await run({ page: ARTICLE_PAGE, candidate, before, identity });

  assert.equal(result.levels.title, 'verified');
  assert.equal(result.levels.creators, 'sourceStated');
  assert.equal(result.levels.date, 'sourceStated');
  assert.equal(result.levels.volume, 'sourceStated');
  assert.equal(result.codes.creators, 'notSelected');
  assert.equal(result.codes.date, 'notSelected');
  // Nothing the page does not back reached the item.
  assert.equal(result.written.creators, null);
  assert.equal(result.written.fields.date, undefined);
  assert.equal(result.written.fields.volume, undefined);
});

// ===========================================================================
// 2. 학위논문 — a Korean thesis whose first page is a licence leaf
// ===========================================================================

const THESIS_PAGE = [
  '저작자표시 - 비영리 - 변경금지 2.0 대한민국',
  '이용자는 아래의 조건을 따르는 경우에 한하여 자유롭게 이 저작물을 복제, 배포, 전송할 수 있습니다.',
  '공학박사 학위논문',
  '나노구조 열전소자의 계면 열저항 저감에 관한 연구',
  '제출일: 2019년 12월',
  '학위수여일: 2021년 8월',
  '학위수여기관: 부산대학교 대학원',
  '지도교수 전 소속: 서울대학교',
  '재료공학부',
  '김 재 현'
].join('\n');

test('학위논문 · positive — a thesis whose cover states its university and year, with the type approved', async () => {
  const before = snapshotOf('document', { title: '저작자표시 - 비영리 - 변경금지 2.0 대한민국' }, []);
  const candidate = snapshotOf('thesis', {
    title: '나노구조 열전소자의 계면 열저항 저감에 관한 연구',
    university: '부산대학교', date: '2021', thesisType: '공학박사 학위논문'
  }, [{ firstName: '재현', lastName: '김' }]);

  // The item type is judged structurally but applied only on a decision, so a
  // person approves it — and the fields the cover states in the right role follow.
  const result = await run({ page: THESIS_PAGE, candidate, before, approve: ['itemType'],
    route: { technicalPDF: true } });

  assert.equal(result.levels.itemType, 'sourceStated');
  assert.equal(result.row.verification.itemType.rule, 'itemType/structure-judged-person-decides');
  assert.equal(result.levels.title, 'verified');
  assert.equal(result.levels.university, 'verified');
  assert.equal(result.levels.date, 'verified');
  assert.equal(result.error, null);
  assert.equal(result.written.itemType, 'thesis');
  assert.equal(result.written.fields.title, '나노구조 열전소자의 계면 열저항 저감에 관한 연구');
  assert.equal(result.written.fields.university, '부산대학교');
  // The author on a Korean cover is spaced by syllable; it still verifies, and a
  // one-character surname no longer makes the check impossible.
  assert.equal(result.levels.creators, 'verified', result.notes.creators);
});

test('학위논문 · negative — the type the cover states is written; a value printed in another role is not', async () => {
  // 서울대학교 and 2019 are both printed on this cover — as the supervisor's
  // former affiliation and as the year the work was submitted. A record that
  // takes either of them is taking a real value in the wrong role.
  const before = snapshotOf('document', { title: '저작자표시 - 비영리 - 변경금지 2.0 대한민국' }, []);
  const candidate = snapshotOf('thesis', {
    title: '나노구조 열전소자의 계면 열저항 저감에 관한 연구',
    university: '서울대학교', date: '2019', thesisType: '공학박사 학위논문'
  }, [{ firstName: '재현', lastName: '김' }]);

  const result = await run({ page: THESIS_PAGE, candidate, before, route: { technicalPDF: true } });

  // 2.0.13: 체크된 필드는 쓰인다. 표지가 「공학박사 학위논문」을 찍었으니 유형은 판독대로 쓰인다.
  // 틀린 역할의 값 — 지도교수 전 소속 「서울대학교」, 제출일 「2019」(학위수여일은 2021년 8월) — 은
  // 쪽이 다르게 말하므로 체크가 풀려 쓰이지 않는다.
  assert.equal(result.codes.itemType, undefined, 'not refused');
  assert.equal(result.written.itemType, 'thesis');
  assert.equal(result.written.fields.date, undefined);
  // Both values ARE on the cover — in the supervisor's affiliation line and in
  // the submission date. Being printed is not being printed in this role.
  assert.equal(result.levels.university, 'sourceStated', result.notes.university);
  assert.equal(result.levels.date, 'sourceStated', result.notes.date);
  assert.equal(result.written.fields.university, undefined);
  // The title the cover does print is still corroborated — a refusal about the
  // type is not a refusal about everything.
  assert.equal(result.levels.title, 'verified');
});

// ===========================================================================
// 3. 보고서 — an institutional report with a number on its cover
// ===========================================================================

const REPORT_PAGE = [
  'KIER-A20215',
  '한국에너지기술연구원',
  '건물용 연료전지 시스템 실증 연구 최종보고서',
  '2022년 12월',
  '연구책임자 박 성 우'
].join('\n');

test('보고서 · positive — issuing body, report number and year all printed on the cover', async () => {
  const before = snapshotOf('report', { title: '연료전지 보고서' }, []);
  const candidate = snapshotOf('report', {
    title: '건물용 연료전지 시스템 실증 연구 최종보고서',
    institution: '한국에너지기술연구원', reportNumber: 'KIER-A20215', date: '2022'
  }, [{ firstName: '성우', lastName: '박' }]);

  const result = await run({ page: REPORT_PAGE, candidate, before, route: { technicalPDF: true } });

  assert.equal(result.levels.title, 'verified');
  assert.equal(result.levels.institution, 'verified');
  assert.equal(result.levels.reportNumber, 'verified');
  assert.equal(result.levels.date, 'verified');
  assert.equal(result.error, null);
  assert.equal(result.written.fields.reportNumber, 'KIER-A20215');
  assert.equal(result.written.fields.institution, '한국에너지기술연구원');
});

test('보고서 · negative — a neighbouring report number in the same series is not this one', async () => {
  const before = snapshotOf('report', { title: '연료전지 보고서' }, []);
  const candidate = snapshotOf('report', {
    title: '건물용 연료전지 시스템 실증 연구 최종보고서',
    institution: '한국에너지기술연구원', reportNumber: 'KIER-A20216', date: '2022'
  }, [{ firstName: '성우', lastName: '박' }]);

  const result = await run({ page: REPORT_PAGE, candidate, before, route: { technicalPDF: true } });

  assert.equal(result.levels.reportNumber, 'sourceStated');
  assert.equal(result.codes.reportNumber, 'notSelected');
  assert.equal(result.written.fields.reportNumber, undefined);
  // The parts the cover does state are unaffected.
  assert.equal(result.written.fields.institution, '한국에너지기술연구원');
});

// ===========================================================================
// 4. 데이터시트 — a component datasheet, where a revision is the whole question
// ===========================================================================

const DATASHEET_PAGE = [
  'LinMot',
  'Linear Motor P01-37x120F-C',
  'Data Sheet',
  'Document Version 3.2',
  'NTI AG / LinMot',
  '2019'
].join('\n');

test('데이터시트 · positive — part number, manufacturer and document version read off the header', async () => {
  const before = snapshotOf('report', { title: 'P01-37x120F-C.pdf' }, []);
  const candidate = snapshotOf('report', {
    title: 'Linear Motor P01-37x120F-C Data Sheet',
    institution: 'NTI AG / LinMot', reportNumber: 'P01-37x120F-C', date: '2019',
    reportType: 'Data Sheet', versionNumber: '3.2'
  }, []);

  const result = await run({ page: DATASHEET_PAGE, candidate, before, route: { technicalPDF: true } });

  assert.equal(result.levels.title, 'verified');
  assert.equal(result.levels.reportNumber, 'verified');
  assert.equal(result.levels.institution, 'verified');
  assert.equal(result.levels.reportType, 'verified');
  // The printed revision is verified and written, not merely tolerated.
  assert.equal(result.levels.versionNumber, 'verified', result.notes.versionNumber);
  assert.equal(result.error, null);
  assert.equal(result.written.fields.reportNumber, 'P01-37x120F-C');
  assert.equal(result.written.fields.versionNumber, '3.2');
});

test('데이터시트 · negative — the same part in a different revision is a different document', async () => {
  // Everything agrees except the revision: same manufacturer, same part number,
  // same title, same year. Revision 4.1 of a datasheet is not revision 3.2 of
  // it, and a rule that only reads titles cannot tell them apart.
  const before = snapshotOf('report', { title: 'P01-37x120F-C.pdf' }, []);
  const candidate = snapshotOf('report', {
    title: 'Linear Motor P01-37x120F-C Data Sheet',
    institution: 'NTI AG / LinMot', reportNumber: 'P01-37x120F-C', date: '2019',
    reportType: 'Data Sheet', versionNumber: '4.1'
  }, []);

  const result = await run({ page: DATASHEET_PAGE, candidate, before, route: { technicalPDF: true } });

  // The page states 3.2, so 4.1 is not merely unconfirmed — it is contradicted.
  assert.equal(result.levels.versionNumber, 'conflicting', result.notes.versionNumber);
  assert.equal(result.codes.versionNumber, 'notSelected');
  assert.equal(result.written.fields.versionNumber, undefined);
  // The fields the page does state are still writable: the refusal is about the
  // revision, and it is not allowed to spread to everything else by contagion.
  assert.equal(result.levels.reportNumber, 'verified');
});

test('데이터시트 · negative — a different part number is refused too', async () => {
  const before = snapshotOf('report', { title: 'P01-37x120F-C.pdf' }, []);
  const candidate = snapshotOf('report', {
    title: 'Linear Motor P01-37x240F-C Data Sheet',
    institution: 'NTI AG / LinMot', reportNumber: 'P01-37x240F-C', date: '2021', reportType: 'Data Sheet'
  }, []);
  const result = await run({ page: DATASHEET_PAGE, candidate, before, route: { technicalPDF: true } });
  assert.equal(result.levels.reportNumber, 'sourceStated');
  assert.equal(result.levels.date, 'sourceStated');
  assert.equal(result.written.fields.reportNumber, undefined);
  assert.equal(result.written.fields.title, undefined);
});

// ===========================================================================
// 5. 도서 — a scanned book, where the printed ISBN may be the container's
// ===========================================================================

const BOOK_PAGE = [
  'Computational Physics',
  'Second Edition',
  'Nicholas J. Giordano and Hisao Nakanishi',
  'Pearson Prentice Hall, Upper Saddle River, New Jersey',
  'Copyright 2006',
  'ISBN: 0131469908'
].join('\n');

test('도서 · positive — the ISBN, publisher and year are the ones on the copyright page', async () => {
  const before = snapshotOf('book', { title: 'Computational Physics' }, []);
  const candidate = snapshotOf('book', {
    title: 'Computational Physics', publisher: 'Pearson Prentice Hall',
    date: '2006', ISBN: '0131469908', edition: 'Second Edition'
  }, [{ firstName: 'Nicholas J.', lastName: 'Giordano' }, { firstName: 'Hisao', lastName: 'Nakanishi' }]);
  const identity = identityFromIdentifier({ kind: 'ISBN', value: '0131469908' }, candidate, 'printedInDocument', POLICY, BOOK_PAGE);

  const result = await run({ page: BOOK_PAGE, candidate, before, identity });

  assert.equal(result.levels.ISBN, 'verified');
  assert.equal(result.levels.publisher, 'verified');
  assert.equal(result.levels.date, 'verified');
  assert.equal(result.levels.creators, 'verified');
  assert.equal(result.levels.edition, 'verified');
  assert.equal(result.error, null);
  assert.equal(result.written.fields.ISBN, '0131469908');
});

test('도서 · negative — a chapter whose page prints the container book ISBN does not take the book record', async () => {
  // The PDF is one chapter. Its first page carries the book's ISBN, so an
  // identifier lookup lands on the book: right identifier, wrong work.
  const chapterPage = [
    'Chapter 3 · Oscillatory Motion and Chaos',
    'In Computational Physics, ISBN: 0131469908, Pearson Prentice Hall',
    'This chapter develops the numerical treatment of the damped driven pendulum.'
  ].join('\n');
  const before = snapshotOf('book', { title: 'Oscillatory Motion and Chaos' }, []);
  const bookRecord = snapshotOf('book', {
    title: 'Computational Physics', publisher: 'Pearson Prentice Hall',
    date: '2006', ISBN: '0131469908', edition: 'Second Edition'
  }, [{ firstName: 'Nicholas J.', lastName: 'Giordano' }, { firstName: 'Hisao', lastName: 'Nakanishi' }]);
  const identity = identityFromIdentifier({ kind: 'ISBN', value: '0131469908' }, bookRecord, 'printedInDocument', POLICY, chapterPage);
  assert.equal(identity.scope, 'container', 'an ISBN resolving to a book is a decision about the container');

  const result = await run({ page: chapterPage, candidate: bookRecord, before, identity });

  // The chapter's own title is nowhere in the book record, and the book's title
  // is on the page only as the container it names — so the rewrite of the stored
  // chapter title is the one thing a person has to decide.
  assert.equal(result.written.fields.title, undefined, 'the chapter title must not be replaced unread');
  assert.equal(result.row.verification.title.identityScope, 'container');
  // The edition and year belong to the book, and the page does print them, so
  // this is exactly the case where the identity question and the field question
  // come apart: a person decides, and the audit can see which is which.
  assert.equal(result.codes.title !== undefined || result.plan.changes.every(c => c.field !== 'title'), true);
});

test('all five types: each positive case actually writes something', async () => {
  // A guard against a change that makes everything reviewable. If no positive
  // case can write, the policy has stopped being a policy — and that has to be
  // checked for every type, not for the one that was easiest to set up.
  const articleCandidate = snapshotOf('journalArticle', {
    title: 'Thermal transport in nanoscale silicon devices',
    publicationTitle: 'Nanoscale', date: '2020', volume: '12', pages: '1234-1245', DOI: '10.1039/d0nr02967j'
  }, []);
  const cases = [
    ['논문', { page: ARTICLE_PAGE, before: snapshotOf('journalArticle', { title: 'Thermal transport in nanoscale devices' }),
      candidate: articleCandidate,
      identity: identityFromIdentifier({ kind: 'DOI', value: '10.1039/d0nr02967j' }, articleCandidate, 'printedInDocument', POLICY, ARTICLE_PAGE) }],
    ['학위논문', { page: THESIS_PAGE, before: snapshotOf('document', { title: '저작자표시 - 비영리 - 변경금지 2.0 대한민국' }),
      candidate: snapshotOf('thesis', { title: '나노구조 열전소자의 계면 열저항 저감에 관한 연구', university: '부산대학교', date: '2021' },
        [{ firstName: '재현', lastName: '김' }]),
      approve: ['itemType'], route: { technicalPDF: true } }],
    ['보고서', { page: REPORT_PAGE, before: snapshotOf('report', { title: '연료전지 보고서' }),
      candidate: snapshotOf('report', { title: '건물용 연료전지 시스템 실증 연구 최종보고서', institution: '한국에너지기술연구원', reportNumber: 'KIER-A20215', date: '2022' },
        [{ firstName: '성우', lastName: '박' }]),
      route: { technicalPDF: true } }],
    ['데이터시트', { page: DATASHEET_PAGE, before: snapshotOf('report', { title: 'P01-37x120F-C.pdf' }),
      candidate: snapshotOf('report', { title: 'Linear Motor P01-37x120F-C Data Sheet', institution: 'NTI AG / LinMot',
        reportNumber: 'P01-37x120F-C', date: '2019', reportType: 'Data Sheet', versionNumber: '3.2' }),
      route: { technicalPDF: true } }],
    ['도서', { page: BOOK_PAGE, before: snapshotOf('book', { title: 'Computational Physics' }),
      candidate: snapshotOf('book', { title: 'Computational Physics', publisher: 'Pearson Prentice Hall', date: '2006', ISBN: '0131469908', edition: 'Second Edition' },
        [{ firstName: 'Nicholas J.', lastName: 'Giordano' }, { firstName: 'Hisao', lastName: 'Nakanishi' }]) }]
  ];
  const wrote = [];
  for (const [label, input] of cases) {
    const result = await run(input);
    const count = Object.keys(result.written.fields).length + (result.written.creators ? 1 : 0);
    assert.ok(count > 0, `${label}: nothing was written — ${JSON.stringify(result.codes)}`);
    assert.equal(result.error, null, `${label}: ${result.error}`);
    assert.deepEqual(scopeless(result.plan.typeFieldLoss), [], `${label} lost fields to a type change`);
    wrote.push(`${label}:${count}`);
  }
  assert.equal(wrote.length, 5, wrote.join(' '));
});

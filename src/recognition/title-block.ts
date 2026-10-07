import { TITLE_LINE_SHAPES, closesSentence, dominantScript, edgeKey, isBylineRow, looksLikeNameList, numberedSectionHeading, opensWithVolume, pageBlocks, continuesAcross, splitColumns, type BlockKind, type BylineNear, type BylineRole, type PageBlock } from './roles';
import { isBodyNameOnly, isHardFurniture, isInstitutionName, isNotAFinishedTitle, isNotATitle, isOrganisationName, isOrganisationOnly, isOwnJournalName, isPersonalName, isPublisherHouseName, isPublishingHouse, isRubricLine, looksLikeBodyProse, namesABodyNotAWork, peopleRow, publicationSentenceOpen, serialNameShaped, stripTitleNoise, DEGREE_LABEL } from './title-guards';
import { STRUCTURE, codeToken, codesOf, hasSentenceSeam, inRegionsOf, isResponsibilityRow, legacyRole, mastheadFor, mostlyRegion, readPageStructure, readingsOf, runningKeys, regionsOf, rowsOf, runningNeighbours, runningTitles, sameTitle, titleOrder, titleRowsOf, type PageStructure, type RegionKind, type TitleRow } from './page-structure';
import { imprintMark } from './imprint-marks';
import { endsOnALatinFunctionWord, opensOnAFunctionWord, parallelRestatement, titleEnding, titleWordsRespelled, titleOpening, typefaceClass } from './title-grammar';
export { parallelRestatement };
import { isOrganisationItem, readBylineRow, rowIsByline } from './byline-row';
type NameTest = (line: string) => boolean;
export const TITLE = {
    display: 1.2, sameSize: 0.15, alignSlack: 8, bylineBlocks: 3, maxRows: 8, maxChars: 300, minAdvance: 0.25,
    floor: { reading: { cjk: 3, latin: 8 }, printed: { cjk: 3, latin: 12 }, seated: 4 }
} as const;
const LIST_ROW = /^[•▪◦‣●○■□–]\s*\S/u;
const ADVISOR_HEAD = /^(?:指導\s*(?:教|敎)?授\s*[:：]?\s*[가-힣\p{Script=Han}·]{2,6}\s+(?=\S.{5,})|지도\s*(?:교수|敎授)\s*[:：]?\s*(?:[가-힣]\s*){2,4}?\s{2,}(?=\S.{5,}))/u;
function hangsAsPrinted(line: string): boolean {
    const value = String(line || '').trim();
    if (/[:;,\-–—]$/.test(value))
        return true;
    return !/[*†‡§¶∗⁎#]$/u.test(value) && endsOnALatinFunctionWord(value);
}
export function readTitleBlock(text: unknown, furniture: (line: string) => boolean, options: {
    layout?: unknown;
    isName?: NameTest;
    lineHeights?: number[];
    skipAt?: Set<number>;
    runningHeads?: Set<string>;
    runningNeighbours?: Map<string, Array<Set<string>>>;
    script?: 'hangul' | 'latin';
    masthead?: [
        number,
        number
    ] | null;
    bodySize?: number;
    width?: number | null;
    bodyScript?: 'hangul' | 'latin' | null;
} = {}): {
    title: string;
    lines: string[];
    label: string | null;
    edition: string | null;
    byline: string | null;
    blocks: number;
    block: {
        index: number;
        start: number;
        end: number;
    } | null;
    structure: Array<{
        kind: BlockKind;
        start: number;
        end: number;
        lines: number;
        role?: BylineRole;
        reason: string;
    }>;
    bylines: BylineNear[];
    continued?: 'displaced';
    parallels?: string[];
    because?: Array<{
        signal: string;
        rows?: number[];
        detail?: string;
    }>;
    height?: number;
    seated?: boolean;
    subtitle?: {
        text: string;
        rows: number[];
        boundary: string;
    } | null;
} {
    const { NFKC, PUBLISHER_WORD, lettersAlike, afterTitle, BY_LINE, DATE_ONLY, PAGE_FURNITURE, WEB_ADDRESS, CODE_LINE, looksLikeCode, EDITION_LINE, HANGUL, LATIN_WORD, stripMarks, roleStatement, ROLE_WORD, TRAILING_ROLE_WORD, roleOfWord, roleWordLine, titleOverByline, ANNEX_DESIGNATION, documentLabel, institutionLine, dateStatement, readableLine, sentenceLine, fullMeasureOpening, proseBlock, personLine, cjkNameList, nameListRow, keyedNameList, markedNameList, median, isPersonShaped, ROMAN_NUMERAL_SIGN, CROSS_REFERENCE, wordBrokenAcross, SENTENCE_INSIDE, CITATION_MARK, KOREAN_SENTENCE_END, opensMidWord, joinTitleLines, compactLetters, sharedPrefix, statedByRunningHead, personWithContact, spacedHangulName } = TITLE_LINE_SHAPES;
    const blocks = pageBlocks(text, furniture, options);
    const measuredRows = Array.isArray(options.lineHeights) && options.lineHeights.some(height => Number(height) > 0);
    const pageLines = NFKC(String(options.layout ?? '').trim() ? options.layout : text).split('\n');
    const lineAbove = (index: number) => {
        for (let at = index - 1; at >= 0 && at > index - 4; at--)
            if (pageLines[at]?.trim())
                return pageLines[at];
        return '';
    };
    const pageEdgeRows = (() => {
        const filled = pageLines.map((row, at) => row.trim() ? at : -1).filter(at => at >= 0);
        return new Set([...filled.slice(0, 2), ...filled.slice(-2)]);
    })();
    const structure = blocks.map(block => ({ kind: block.kind, start: block.start, end: block.end, lines: block.lines.length,
        ...(block.role ? { role: block.role } : {}), reason: block.reason }));
    const none = (label: string | null) => ({ title: '', lines: [] as string[], label, edition: null, byline: null, blocks: blocks.length, block: null, structure, bylines: [] as BylineNear[] });
    const rowSizes = Array.isArray(options.lineHeights) && options.lineHeights.length ? options.lineHeights : null;
    const textSize = rowSizes ? (Number(options.bodySize) > 0 ? Number(options.bodySize) : median(pageLines.map((row, index) => row.trim() ? Number(rowSizes[index]) || 0 : 0))) : 0;
    const width = Number(options.width) > 0 ? Number(options.width) : 0;
    const rotatedAt = (row: number) => {
        if (!width || !rowSizes)
            return false;
        const letters = (NFKC(pageLines[row] || '').match(/[\p{L}\p{N}]/gu) || []).length;
        return letters * (Number(rowSizes[row]) || 0) * TITLE.minAdvance > width;
    };
    const sizeAt = (row: number) => rowSizes && !rotatedAt(row) ? Number(rowSizes[row]) || 0 : 0;
    const sameTextSize = (here: number, there: number) => textSize > 0 && here > 0 && there > 0 && here < textSize * 1.2
        && Math.abs(here - there) <= Math.max(here, there) * 0.1;
    const ownBodyMark = (block: PageBlock): boolean => {
        if (block.kind === 'prose')
            return true;
        const lines = block.lines.map(line => NFKC(line).trim());
        if (lines.some(line => opensMidWord(line, { stop: true })))
            return true;
        if (lines.some(line => SENTENCE_INSIDE.test(line) || CROSS_REFERENCE.test(line) || CITATION_MARK.test(line) || KOREAN_SENTENCE_END.test(line)))
            return true;
        return lines.some((line, at) => at + 1 < lines.length && wordBrokenAcross(line, lines[at + 1]));
    };
    const proseEvidence = (block: PageBlock, next: PageBlock | undefined): boolean => {
        if (ownBodyMark(block))
            return true;
        const lines = block.lines.map(line => NFKC(line).trim());
        const last = lines[lines.length - 1] || '';
        return !!next && HANGUL.test(last) && !/[.!?:;]$/.test(last)
            && opensMidWord(next.lines[0] || '', { ambiguous: sameTextSize(sizeAt(block.end), sizeAt(next.start)) });
    };
    const linesAfter = (at: number, offset: number): string[] => {
        const out = blocks[at].lines.slice(offset + 1);
        for (let next = at + 1; next < blocks.length && out.length < 4; next++)
            out.push(...blocks[next].lines);
        return out.slice(0, 4);
    };
    const bylineFollows = (at: number, offset: number): boolean => {
        const named = (line: string) => nameListRow(line, options.isName) || markedNameList(line, options.isName) || !!personWithContact(line, options.isName)?.email;
        if (blocks[at]?.lines.slice(offset + 1).some(named))
            return true;
        for (let next = at + 1; next < blocks.length && next - at <= STRUCTURE.bylineBlocks; next++) {
            if (blocks[next].kind === 'byline' || blocks[next].lines.some(named))
                return true;
        }
        return false;
    };
    const headingKey = (line: string) => NFKC(line).replace(/\s+/g, '');
    const romanHeadings = new Set<string>();
    for (const row of String(String(options.layout ?? '').trim() ? options.layout : text ?? '').split('\n')) {
        for (const column of splitColumns(row))
            if (ROMAN_NUMERAL_SIGN.test(column) && numberedSectionHeading(column))
                romanHeadings.add(headingKey(column));
    }
    const headingAt = (at: number, offset: number) => numberedSectionHeading(blocks[at].lines[offset], linesAfter(at, offset))
        || (romanHeadings.size > 0 && romanHeadings.has(headingKey(blocks[at].lines[offset] || '')));
    const flowRows = new Set<number>();
    if (measuredRows && String(options.layout ?? '').trim()) {
        const indentAt = (row: number) => { const raw = pageLines[row] || ''; return raw.length - raw.trimStart().length; };
        const oneColumn = (row: number) => splitColumns(pageLines[row] || '').length === 1;
        const endsSentence = (row: number) => /[.!?。．]["'”’)\]]*$/u.test(String(pageLines[row] || '').trim());
        const proseRows = new Set<number>();
        for (const block of blocks)
            if (block.kind === 'prose')
                for (let row = block.start; row <= block.end; row++)
                    proseRows.add(row);
        const bodyMarked = (row: number) => {
            const line = String(pageLines[row] || '').trim();
            return proseRows.has(row) || opensMidWord(line, { stop: true }) || SENTENCE_INSIDE.test(line) || CROSS_REFERENCE.test(line) || CITATION_MARK.test(line)
                || KOREAN_SENTENCE_END.test(line);
        };
        const sameColumn = (upper: number, lower: number) => oneColumn(upper) && oneColumn(lower) && Math.abs(indentAt(upper) - indentAt(lower)) <= 1
            && sizeAt(upper) > 0 && sizeAt(lower) > 0 && Math.abs(sizeAt(upper) - sizeAt(lower)) <= Math.max(sizeAt(upper), sizeAt(lower)) * TITLE.sameSize;
        const filled = pageLines.map((line, row) => line.trim() ? row : -1).filter(row => row >= 0);
        const widthAt = (row: number) => String(pageLines[row] || '').trim().length;
        filled.forEach((row, k) => {
            const previous = filled[k - 1];
            if (previous === undefined || !sameColumn(previous, row) || endsSentence(previous))
                return;
            const column = [previous];
            let spacing = -1;
            for (let j = k - 2; j >= 0 && column.length < 6; j--) {
                const lower = column[column.length - 1];
                if (!sameColumn(filled[j], lower))
                    break;
                spacing = Math.max(spacing, lower - filled[j] - 1);
                column.push(filled[j]);
            }
            const measure = median(column.slice(1).map(widthAt));
            const filledTheMeasure = measure > 0 && widthAt(previous) >= measure * 0.85;
            if (column.length >= 2 && filledTheMeasure && row - previous - 1 <= spacing && column.filter(bodyMarked).length >= 2)
                flowRows.add(row);
        });
    }
    const sectionBody = new Set<number>();
    {
        let headingHeight = 0;
        const titleSized = (block: PageBlock) => textSize > 0 && block.height >= textSize * 1.2 && !ownBodyMark(block)
            && !(headingHeight > 0 && block.height <= headingHeight);
        const runs = (block: PageBlock) => (block.kind === 'text' || block.kind === 'prose' || block.kind === 'furniture')
            && block.gapBefore <= 1 && !titleSized(block)
            && !(options.runningHeads?.size && statedByRunningHead(options.runningHeads, joinTitleLines(block.lines)));
        const bylineBelow = (at: number) => !!blocks[at + 1] && (blocks[at + 1].kind === 'byline' || nameListRow(blocks[at + 1].lines[0] || '', options.isName));
        const evidenced = (at: number) => proseEvidence(blocks[at], blocks[at + 1]);
        let open = false;
        blocks.forEach((block, at) => {
            if (open) {
                const ahead = [at + 1, at + 2].filter(index => index < blocks.length);
                const carried = evidenced(at) || ahead.some((index, step) => ahead.slice(0, step + 1).every(k => runs(blocks[k])) && evidenced(index));
                if (runs(block) && !bylineBelow(at) && carried)
                    sectionBody.add(at);
                else {
                    open = false;
                    headingHeight = 0;
                }
            }
            if (block.lines.some((_, offset) => headingAt(at, offset))) {
                open = true;
                headingHeight = block.height;
            }
        });
        const firstFilled = (block: PageBlock) => { for (let row = block.start; row <= block.end; row++)
            if (pageLines[row]?.trim())
                return row; return -1; };
        const lastFilled = (block: PageBlock) => { for (let row = block.end; row >= block.start; row--)
            if (pageLines[row]?.trim())
                return row; return -1; };
        blocks.forEach((block, at) => {
            if (at === 0 || block.gapBefore > 1 || !block.lines.some((_, offset) => headingAt(at, offset)) || !flowRows.has(lastFilled(blocks[at - 1])))
                return;
            for (let back = at - 1; back >= 0; back--) {
                sectionBody.add(back);
                if (!flowRows.has(firstFilled(blocks[back])))
                    break;
            }
        });
    }
    const filledAfter = (row: number): {
        text: string;
        at: number;
    } | null => {
        for (let at = row + 1; at < pageLines.length; at++) {
            const columns = splitColumns(pageLines[at]);
            if (!columns.length)
                continue;
            const widest = columns.reduce((best, column) => (column.match(/\p{L}/gu) || []).length > (best.match(/\p{L}/gu) || []).length ? column : best);
            return { text: stripMarks(widest), at };
        }
        return null;
    };
    const wrappedProse = (lines: string[], block: PageBlock, lastOffset: number): boolean => {
        if (opensMidWord(lines[0] || '', { stop: true }))
            return true;
        if (lines.some(line => CROSS_REFERENCE.test(line) || CITATION_MARK.test(line)))
            return true;
        if (!(textSize > 0 && block.height >= textSize * 1.2)
            && lines.some((line, at) => at + 1 < lines.length && wordBrokenAcross(line, lines[at + 1])))
            return true;
        if (lines.slice(1).some((line, at) => HANGUL.test(lines[at]) && opensMidWord(line)))
            return true;
        const last = String(lines[lines.length - 1] || '').trim();
        if (/\b(?:at|of|for|in|on|to|from|by|with|via|visit|see)$/i.test(last) && WEB_ADDRESS.test(String((lastOffset + 1 < block.lines.length ? block.lines[lastOffset + 1] : filledAfter(block.end)?.text) || '').trim()))
            return true;
        if (!HANGUL.test(last) || /[.!?:;]$/.test(last))
            return false;
        const inside = lastOffset + 1 < block.lines.length;
        const after = inside ? null : filledAfter(block.end);
        const next = inside ? block.lines[lastOffset + 1] : after?.text;
        if (!next || personLine(next, options.isName) || nameListRow(next, options.isName) || spacedHangulName(next, options.isName))
            return false;
        const here = inside ? block.height : sizeAt(block.end), there = inside ? block.height : sizeAt(after!.at);
        return opensMidWord(next, { ambiguous: sameTextSize(here, there) });
    };
    let label: string | null = null;
    const labelsSeen: Array<{
        text: string;
        row: number;
    }> = [];
    const noteLabel = (text: string, row: number) => { labelsSeen.push({ text, row }); label = label || text; };
    const candidates: Array<{
        lines: string[];
        at: number;
        start: number;
        end: number;
        parallel?: boolean;
    }> = [];
    const bodyName = (value: string) => serialNameShaped(value) || isOrganisationOnly(value) || isInstitutionName(value) || isOrganisationName(value);
    const namePiece = (value: string) => !WEB_ADDRESS.test(value.trim()) && !CODE_LINE.test(value) && !looksLikeCode(value);
    const bodyNamePhrase = (head: string, tail: string, piece: string) => namePiece(head) && namePiece(tail) && bodyName(joinTitleLines([head, tail])) && !bodyName(piece.trim());
    blocks.forEach((block, at) => {
        if (block.kind === 'label') {
            noteLabel(block.lines[0], block.start);
            return;
        }
        if (block.kind !== 'text')
            return;
        if (sectionBody.has(at))
            return;
        if (proseBlock(block.lines) && (continuesAcross(block.lines[0], block.lines[1]) || fullMeasureOpening(block.lines)))
            return;
        const taken: string[] = [];
        const rows: number[] = [];
        const filledRows: number[] = [];
        for (let row = block.start; row <= block.end; row++)
            if (pageLines[row]?.trim())
                filledRows.push(row);
        const rowAt = (offset: number) => filledRows.length === block.lines.length ? filledRows[offset] : block.start + offset;
        const offsetOf = (row: number) => filledRows.length === block.lines.length ? filledRows.indexOf(row) : row - block.start;
        const firstLine = (line: string, offset: number): 'label' | 'skip' | 'take' => {
            if (documentLabel(line) || EDITION_LINE.test(line) || ANNEX_DESIGNATION.test(line) || isRubricLine(line))
                return 'label';
            if (/^\p{Ll}\p{L}*(?:\s+\p{Ll}\p{L}*){0,2}$/u.test(line.trim()))
                return 'skip';
            if (headingAt(at, offset))
                return 'skip';
            if (CODE_LINE.test(line) || looksLikeCode(line) || codeToken(line.trim()))
                return 'skip';
            if (WEB_ADDRESS.test(line.trim()))
                return 'skip';
            if (publicationSentenceOpen(lineAbove(rowAt(offset))))
                return 'skip';
            if (PAGE_FURNITURE.test(line) || dateStatement(line) || afterTitle(line) || roleStatement(line) || ROLE_WORD.test(line) || BY_LINE.test(line))
                return 'skip';
            if (roleWordLine(line, options.isName))
                return 'skip';
            if (markedNameList(line, options.isName) || personWithContact(line, options.isName)?.email)
                return 'skip';
            if (institutionLine(line) || !readableLine(line) || sentenceLine(line))
                return 'skip';
            if (DEGREE_LABEL.test(line))
                return 'skip';
            const below = offset + 1 < block.lines.length ? block.lines[offset + 1] : '';
            if (below && HANGUL.test(line) !== HANGUL.test(below) && line.trim().split(/\s+/).length <= 3 && (documentLabel(below) || DEGREE_LABEL.test(below)))
                return 'label';
            const next = offset + 1 < block.lines.length ? block.lines[offset + 1] : blocks[at + 1]?.lines[0];
            if (furniture(line) && !(!candidates.length && !taken.length && titleOverByline(line, String(next || ''), options.isName)))
                return 'skip';
            return 'take';
        };
        let parallel = false;
        const skippedHead: string[] = [];
        let awaitingValue = false;
        let flowedIntoASentence = false;
        const flush = () => {
            const kept = rows.filter(row => row >= 0);
            const lines = [...taken];
            const last = lines[lines.length - 1] || '', lastKey = edgeKey(last);
            const others = lines.slice(0, -1).map(edgeKey);
            const elsewhere = options.runningNeighbours?.get(lastKey)
                ?.some(around => ![...around].some(key => key !== lastKey && others.some(other => lettersAlike(key, other)))) ?? false;
            if (lines.length > 1 && elsewhere && options.runningHeads?.has(lastKey) && pageEdgeRows.has(kept[kept.length - 1])
                && lines.some(line => !options.runningHeads!.has(edgeKey(line)))
                && !(textSize > 0 && sizeAt(kept[kept.length - 1]) >= textSize * 1.2)
                && !hangsAsPrinted(lines[lines.length - 2]) && !opensOnAFunctionWord(last) && !HANGUL.test(last)) {
                lines.pop();
                kept.pop();
            }
            if (lines.length && !proseBlock(lines) && !flowedIntoASentence && !options.skipAt?.has(at) && !flowRows.has(kept[0]) && !wrappedProse(lines, block, offsetOf(kept[kept.length - 1]))) {
                candidates.push({ lines, at, start: kept[0], end: kept[kept.length - 1], ...(parallel ? { parallel } : {}) });
            }
        };
        block.lines.forEach((line, offset) => {
            if (rows.length && rows[rows.length - 1] < 0)
                return;
            if (taken.length && headingAt(at, offset))
                return void rows.push(-1);
            if (!taken.length) {
                if (awaitingValue)
                    return;
                const advisorHead = ADVISOR_HEAD.exec(line);
                if (advisorHead)
                    line = line.slice(advisorHead[0].length);
                const verdict = firstLine(line, offset);
                if (verdict === 'label')
                    noteLabel(line, rowAt(offset));
                if (verdict === 'skip') {
                    skippedHead.push(line);
                    if (afterTitle(line) && /[:：]\s*$/.test(line))
                        awaitingValue = true;
                    return;
                }
                if (verdict !== 'take') {
                    skippedHead.length = 0;
                    return;
                }
                if (skippedHead.length && (titleOpening(line) === 'continuing' || bodyNamePhrase(skippedHead[skippedHead.length - 1], line, line))) {
                    skippedHead.push(line);
                    return;
                }
                skippedHead.length = 0;
                taken.push(line);
                rows.push(rowAt(offset));
                return;
            }
            const stop = () => rows.push(-1);
            const lastTaken = taken[taken.length - 1].trim();
            const hanging = titleEnding(lastTaken) === 'open';
            const labelHere = isRubricLine(line)
                && (offset + 1 < block.lines.length || line.trim().split(/\s+/).length < 2);
            if (!hanging && labelHere && taken.join(' ').split(/\s+/).length <= 8) {
                noteLabel(line, rowAt(offset));
                taken.length = 0;
                rows.length = 0;
                return;
            }
            if (afterTitle(line) || dateStatement(line) || documentLabel(line))
                return stop();
            if (BY_LINE.test(line) && taken.join(' ').length >= 8)
                return stop();
            if (opensWithVolume(line))
                return stop();
            if (PAGE_FURNITURE.test(line) || EDITION_LINE.test(line) || roleStatement(line) || ROLE_WORD.test(line))
                return stop();
            if (roleWordLine(line, options.isName))
                return stop();
            const last = taken[taken.length - 1];
            const continuation = continuesAcross(last, line);
            const personBelowTheSchool = () => block.lines.slice(offset + 2, offset + 8).some(later => personLine(later, options.isName) && !institutionLine(later)
                && !isResponsibilityRow(later) && !roleStatement(later) && !dateStatement(later));
            if (!continuation && taken.join(' ').length >= 24 && line.trim().split(/\s+/).length <= 4
                && institutionLine(String(block.lines[offset + 1] || '')) && (!HANGUL.test(line) || isPersonalName(line.replace(/\s+/g, '')))
                && !personBelowTheSchool())
                return stop();
            if (hasSentenceSeam(line)) {
                if (continuation)
                    flowedIntoASentence = true;
                return stop();
            }
            const koreanHanging = continuation && HANGUL.test(last) && HANGUL.test(line);
            if (!koreanHanging && peopleRow(line))
                return stop();
            if (!koreanHanging && !continuation && rowIsByline(line, 'strict'))
                return stop();
            const below = String(block.lines[offset + 1] ?? blocks[at + 1]?.lines[0] ?? '').trim();
            if (LIST_ROW.test(line.trim()) || (LIST_ROW.test(below) && line.trim().split(/\s+/).length <= 2))
                return stop();
            if (!measuredRows && !continuation && titleEnding(last) !== 'open') {
                const row = readBylineRow(line);
                if ((row.kind === 'single' || row.kind === 'pair') && row.items.length && row.items.every(item => item.shape.person !== 'no')) {
                    const below = String(block.lines[offset + 1] ?? blocks[at + 1]?.lines[0] ?? '').trim();
                    const belowKind = below ? readBylineRow(below).kind : 'none';
                    const sure = row.items.every(item => item.shape.person === 'sure' || /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.text));
                    const foot = !below || isPublisherHouseName(below) || isPublishingHouse(below);
                    if (foot || (sure && (isOrganisationItem(below) || belowKind === 'affiliation' || belowKind === 'contact')))
                        return stop();
                }
            }
            if (!continuation && isResponsibilityRow(line))
                return stop();
            if ((!koreanHanging || keyedNameList(line, options.isName)) && cjkNameList(line, options.isName))
                return stop();
            if (!koreanHanging && spacedHangulName(line, options.isName))
                return stop();
            if (WEB_ADDRESS.test(line.trim()))
                return stop();
            const soleNameWithBylineBelow = !continuation && bylineFollows(at, offset) && ((HANGUL.test(last) && HANGUL.test(line) && isPersonalName(line.replace(/\s+/g, '')))
                || (!HANGUL.test(last) && !HANGUL.test(line) && isPersonShaped(line) && !nameListRow(line, options.isName)));
            if (continuation || soleNameWithBylineBelow ? isHardFurniture(line) : furniture(line))
                return stop();
            if (institutionLine(line))
                return stop();
            const standfirst = /[.!]["”’)]?$/.test(line.trim()) && line.trim().split(/\s+/).length >= 6;
            if (!readableLine(line))
                return stop();
            if (!continuation && (CODE_LINE.test(line) || looksLikeCode(line) || sentenceLine(line) || standfirst))
                return stop();
            const soFar = taken.join(' ');
            const respelled = !HANGUL.test(soFar) && !HANGUL.test(line) && soFar.length >= 12 ? titleWordsRespelled(soFar, line) : 0;
            const titleRows = rows.filter(row => row >= 0);
            const otherType = respelled === 1 && sizeAt(rowAt(offset)) > 0 && titleRows.length > 0 && sizeAt(titleRows[titleRows.length - 1]) > 0
                && Math.abs(sizeAt(rowAt(offset)) - sizeAt(titleRows[titleRows.length - 1])) > Math.max(sizeAt(rowAt(offset)), sizeAt(titleRows[titleRows.length - 1])) * TITLE.sameSize;
            const restated = (respelled >= 2 || otherType) && parallelRestatement(soFar, block.lines.slice(offset, offset + 3).join(' '));
            if ((HANGUL.test(soFar) && !HANGUL.test(line) && LATIN_WORD.test(line) && soFar.length >= 12)
                || (!HANGUL.test(soFar) && HANGUL.test(line) && soFar.length >= 12) || restated) {
                if (firstLine(line, offset) !== 'take')
                    return stop();
                flush();
                taken.length = 0;
                rows.length = 0;
                parallel = true;
                taken.push(line);
                rows.push(rowAt(offset));
                return;
            }
            taken.push(line);
            rows.push(rowAt(offset));
            if (taken.join(' ').length > 300 || taken.length >= 8)
                return stop();
        });
        flush();
    });
    const verticalCandidate = (entry: {
        at: number;
    }) => !!blocks[entry.at]?.vertical;
    if (candidates.some(entry => !verticalCandidate(entry)))
        candidates.splice(0, candidates.length, ...candidates.filter(entry => !verticalCandidate(entry)));
    const because: Array<{
        signal: string;
        rows?: number[];
        detail?: string;
    }> = [];
    if (candidates.length && verticalCandidate(candidates[0]))
        because.push({ signal: 'rotated', rows: [candidates[0].start, candidates[0].end], detail: 'vertical text is the only title on the page' });
    if (!candidates.length)
        return none(label);
    const candidateAt = new Map(candidates.map(entry => [entry.start, entry] as const));
    let chosen = candidates[0];
    let byline: string | null = null;
    for (let at = 0; at + 1 < candidates.length; at++) {
        const here = candidates[at], after = candidates[at + 1];
        const last = here.lines[here.lines.length - 1];
        const nameAfter = isPersonShaped(after.lines[0]) && !(titleEnding(last) === 'open' && !nameListRow(after.lines[0], options.isName));
        if (after.at !== here.at + 1 || !continuesAcross(last, after.lines[0]) || nameAfter)
            continue;
        if ((isPersonalName(after.lines[0].replace(/\s+/g, '')) && !bylineFollows(after.at, 0))
            || here.end < blocks[here.at].end)
            continue;
        candidates.splice(at, 2, { lines: [...here.lines, ...after.lines], at: here.at, start: here.start, end: after.end });
        at--;
    }
    for (let index = candidates.length - 1; index >= 0; index--) {
        const entry = candidates[index];
        const below = pageLines[entry.end + 1];
        if (!below?.trim() || candidates.some(other => other !== entry && other.start <= entry.end + 1 && other.end >= entry.end + 1))
            continue;
        if (!furniture(below) || furniture(joinTitleLines(entry.lines)))
            continue;
        if (bodyNamePhrase(joinTitleLines(entry.lines), below.trim(), joinTitleLines(entry.lines)))
            candidates.splice(index, 1);
    }
    if (!candidates.length)
        return none(label);
    if (options.script) {
        const hangul = options.script === 'hangul';
        const kept = candidates.filter(entry => HANGUL.test(entry.lines.join(' ')) === hangul);
        candidates.splice(0, candidates.length, ...kept);
        if (!candidates.length)
            return none(label);
    }
    const scriptOfEntry = (entry: {
        lines: string[];
    }) => HANGUL.test(entry.lines.join(' ')) ? 'hangul' : 'latin';
    const pageScript = options.bodyScript ?? (dominantScript(String(options.layout ?? '').trim() ? options.layout : text) === 'latin' ? 'latin' : 'hangul');
    const parallels: string[] = [];
    if (candidates.length > 1 && scriptOfEntry(candidates[0]) !== pageScript && scriptOfEntry(candidates[1]) === pageScript
        && (candidates[1].at === candidates[0].at || candidates[1].at === candidates[0].at + 1)) {
        const other = candidates[0];
        parallels.push(joinTitleLines(other.lines));
        because.push({ signal: 'bodyScript', rows: [candidates[1].start, candidates[1].end], detail: `parallel ${other.start}-${other.end}` });
        candidates.splice(0, 2, candidates[1], other);
        if (other.start < candidates[0].start)
            noteLabel(other.lines[0], other.start);
    }
    else if (candidates.length > 1 && scriptOfEntry(candidates[0]) !== scriptOfEntry(candidates[1])
        && (candidates[1].at === candidates[0].at || candidates[1].at === candidates[0].at + 1)) {
        parallels.push(joinTitleLines(candidates[1].lines));
    }
    const measuredHeights = Array.isArray(options.lineHeights) && options.lineHeights.length === pageLines.length ? options.lineHeights : null;
    const rowHeights = measuredHeights ? pageLines.map((row, at) => row.trim() ? sizeAt(at) : 0) : null;
    const bodyHeight = rowHeights ? textSize : 0;
    const worded = (row: number) => (NFKC(pageLines[row] || '').match(/\p{L}/gu) || []).length >= 2;
    const measured = (entry: {
        start: number;
        end: number;
    }) => {
        const heights: number[] = [];
        for (let row = entry.start; row <= entry.end; row++)
            if (worded(row) && (rowHeights?.[row] || 0) > 0)
                heights.push(rowHeights![row]);
        return heights.sort((a, b) => a - b);
    };
    const sizeOf = (entry: {
        start: number;
        end: number;
    }) => {
        const lettered: number[] = [];
        for (let row = entry.start; row <= entry.end; row++) {
            if (!worded(row))
                continue;
            const value = rowHeights?.[row] || 0;
            if (value > 0)
                lettered.push(value);
        }
        lettered.sort((a, b) => a - b);
        return lettered.length ? lettered[Math.floor((lettered.length - 1) / 2)] : 0;
    };
    const tallest = (entry: {
        start: number;
        end: number;
    }) => measured(entry).pop() || 0;
    const displayed = (height: number) => bodyHeight > 0 && height >= bodyHeight * TITLE.display;
    const sameSize = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(a, b) * TITLE.sameSize;
    const bylineAt = (at: number) => {
        const block = blocks[at];
        if (!block)
            return false;
        const first = block.lines[0] || '';
        return block.kind === 'byline' || nameListRow(first, options.isName) || !!personWithContact(first, options.isName);
    };
    const sectionEnd = Math.max(-1, ...[...sectionBody].map(at => blocks[at].end));
    const titleAfterBody = sectionBody.size > 0 && bodyHeight > 0
        && candidates.some(entry => entry.start > sectionEnd && displayed(sizeOf(entry)) && [1, 2, 3].some(step => bylineAt(entry.at + step)));
    const marginal = (block: PageBlock) => bodyHeight > 0 && block.height > 0 && block.height < bodyHeight * (1 - TITLE.sameSize);
    const titleAfterMargin = bodyHeight > 0 && blocks.some(block => block.kind === 'prose' && marginal(block))
        && candidates.some(entry => displayed(sizeOf(entry)) && [1, 2, 3].some(step => bylineAt(entry.at + step)));
    const firstProse = blocks.find((block, at) => block.kind === 'prose' && !(titleAfterBody && sectionBody.has(at)) && !(titleAfterMargin && marginal(block)))?.start ?? -1;
    const titleShapedAt = (entry: {
        lines: string[];
        start: number;
        end: number;
    }) => (firstProse < 0 || entry.start < firstProse)
        && entry.lines.some(line => (NFKC(line).match(/\p{L}/gu) || []).length >= 2);
    const largest = rowHeights ? Math.max(0, ...candidates.filter(titleShapedAt).map(sizeOf)) : 0;
    if (rowHeights && bodyHeight > 0 && largest === 0 && firstProse >= 0 && candidates.every(entry => entry.start > firstProse)
        && !candidates.some(entry => displayed(sizeOf(entry))))
        return none(label);
    const namesOnly = (entry: {
        lines: string[];
    }) => entry.lines.every(line => !/[.,:;]$/.test(line.trim())
        && (isPersonShaped(line) || (HANGUL.test(line) && !!options.isName && options.isName(line))));
    const edgeRows = pageEdgeRows;
    const passableKinds = new Set<BlockKind>(['label', 'date', 'institution', 'role', 'code', 'furniture']);
    const bylineNear = (entry: {
        at: number;
    }) => {
        const script = scriptOf(blocks[entry.at].lines.join(' '));
        for (let up = entry.at - 1; up >= 0 && up >= entry.at - 1 - TITLE.bylineBlocks; up--) {
            const block = blocks[up];
            if (block.kind === 'byline') {
                if (scriptOf(block.lines.join(' ')) === script)
                    return true;
                break;
            }
            if (block.kind === 'text' && block.lines.length <= 3 && scriptOf(block.lines.join(' ')) !== script)
                continue;
            break;
        }
        for (let step = 1; step <= TITLE.bylineBlocks && entry.at + step < blocks.length; step++) {
            if (bylineAt(entry.at + step))
                return true;
            const block = blocks[entry.at + step];
            if (passableKinds.has(block.kind))
                continue;
            if (block.kind === 'text' && block.lines.length <= 3 && scriptOf(block.lines.join(' ')) !== scriptOf(blocks[entry.at].lines.join(' ')))
                continue;
            break;
        }
        return false;
    };
    const firstShaped = candidates.find(titleShapedAt);
    if (rowHeights && bodyHeight > 0 && firstProse >= 0 && !candidates.some(entry => displayed(sizeOf(entry)))
        && !!firstShaped && blocks[firstShaped.at + 1]?.kind === 'prose' && !bylineNear(firstShaped) && !(options.runningHeads?.size
        && candidates.some(entry => statedByRunningHead(options.runningHeads!, joinTitleLines(entry.lines)))))
        return none(label);
    const seedHeight = (() => {
        if (!rowHeights || !(bodyHeight > 0))
            return 0;
        const pool = candidates.filter(entry => titleShapedAt(entry) && displayed(sizeOf(entry)));
        const titled = pool.filter(entry => !namesOnly(entry));
        return Math.max(0, ...(titled.length ? titled : pool).map(sizeOf));
    })();
    const stated = options.runningHeads?.size && candidates.length > 1
        ? candidates.findIndex(entry => !edgeRows.has(entry.start) && !edgeRows.has(entry.end) && titleShapedAt(entry) && !namesOnly(entry)
            && (!(bodyHeight > 0) || (displayed(sizeOf(entry)) && (sizeOf(entry) >= seedHeight || sameSize(sizeOf(entry), seedHeight))))
            && statedByRunningHead(options.runningHeads!, joinTitleLines(entry.lines)))
        : -1;
    if (stated > 0) {
        candidates.unshift(...candidates.splice(stated, 1));
        because.push({ signal: 'restated', rows: [candidates[0].start, candidates[0].end], detail: 'running head' });
    }
    let namesAbove: {
        lines: string[];
        start: number;
        end: number;
    } | null = null;
    let seeded = false;
    if (stated <= 0 && seedHeight > 0) {
        const ties = candidates.map((entry, index) => ({ entry, index })).filter(({ entry }) => titleShapedAt(entry) && displayed(sizeOf(entry)) && sameSize(sizeOf(entry), seedHeight));
        const besideByline = ties.find(({ entry }) => bylineNear(entry));
        let top = (besideByline ?? ties[0])?.index ?? -1;
        const rubricSeat = candidates.findIndex(entry => titleShapedAt(entry) && displayed(sizeOf(entry)) && entry.at > 0 && blocks[entry.at - 1].lines.length === 1
            && isRubricLine(blocks[entry.at - 1].lines[0]) && !EDITION_LINE.test(blocks[entry.at - 1].lines[0]) && bylineNear(entry));
        const underRubric = top >= 0 && rubricSeat > top && !bylineNear(candidates[top]) && sizeOf(candidates[top]) > sizeOf(candidates[rubricSeat]);
        if (underRubric) {
            top = rubricSeat;
            because.push({ signal: 'rubricSeat', rows: [blocks[candidates[top].at - 1].start, blocks[candidates[top].at - 1].end] });
        }
        if (top >= 0)
            seeded = true;
        const tiedAbove = new Set(besideByline ? ties.map(({ entry }) => entry) : []);
        if (top > 0 && (underRubric || candidates.slice(0, top).every(entry => !titleShapedAt(entry) || tiedAbove.has(entry)
            || (tallest(entry) > 0 && tallest(entry) < seedHeight && !sameSize(tallest(entry), seedHeight))))) {
            const above = candidates[top - 1];
            if (namesOnly(above) && above.at === candidates[top].at - 1)
                namesAbove = { lines: above.lines, start: above.start, end: above.end };
            for (const skipped of candidates.slice(0, top))
                if (!(namesAbove && skipped === above))
                    noteLabel(skipped.lines[0], skipped.start);
            candidates.splice(0, top);
        }
        if (top >= 0)
            because.push({ signal: 'display', rows: [candidates[0].start, candidates[0].end], detail: `${sizeOf(candidates[0]).toFixed(1)} over ${bodyHeight.toFixed(1)}` });
    }
    if (!seeded && stated <= 0 && rowHeights && bodyHeight > 0 && candidates.length > 1) {
        const fine = (entry: {
            start: number;
            end: number;
        }) => sizeOf(entry) > 0 && sizeOf(entry) < bodyHeight * (1 - TITLE.sameSize);
        const top = candidates.findIndex(entry => titleShapedAt(entry) && !fine(entry) && sizeOf(entry) > 0);
        if (top > 0 && candidates.slice(0, top).every(fine)) {
            candidates.splice(0, top);
            because.push({ signal: 'aboveFinePrint', rows: [candidates[0].start, candidates[0].end] });
        }
    }
    if (stated <= 0 && !rowHeights && candidates.length > 1) {
        const top = candidates.findIndex(entry => titleShapedAt(entry) && bylineNear(entry));
        if (top > 0) {
            for (const skipped of candidates.slice(0, top))
                noteLabel(skipped.lines[0], skipped.start);
            candidates.splice(0, top);
            because.push({ signal: 'besideByline', rows: [candidates[0].start, candidates[0].end] });
        }
        else if (top < 0 && !blocks.some(block => block.kind === 'byline'
            || (block.kind === 'text' && block.lines.length <= 3 && block.lines.every(line => personLine(line, options.isName) && isPersonShaped(line))))) {
            const [first, second] = candidates;
            if (first.lines.length === 1 && typefaceClass(first.lines[0]) === 'capitals' && second.at === first.at + 1 && blocks[second.at].gapBefore <= 1
                && typefaceClass(second.lines.join(' ')) === 'mixed' && titleShapedAt(second) && second.lines.join(' ').split(/\s+/).length > first.lines[0].split(/\s+/).length) {
                noteLabel(first.lines[0], first.start);
                candidates.shift();
                because.push({ signal: 'typefaceBoundary', rows: [first.start, first.end] });
            }
        }
    }
    while (candidates.length > 1 && candidates[0].lines.length > 1 && furniture(joinTitleLines(candidates[0].lines))) {
        const head = candidates.shift()!;
        noteLabel(head.lines[0], head.start);
    }
    chosen = candidates[0];
    const opener = chosen.lines.length === 1 ? chosen.lines[0].trim() : null;
    const rubric = !seeded && opener !== null && /^\S{2,20}$/.test(opener) && (isRubricLine(opener) || documentLabel(opener));
    const nameShaped = opener !== null && (isPersonShaped(opener) || (HANGUL.test(opener) && !!options.isName && options.isName(opener)));
    const authorLine = (line: string) => {
        const value = NFKC(line).trim();
        if (isOrganisationName(value) || PUBLISHER_WORD.test(value))
            return false;
        const role = TRAILING_ROLE_WORD.exec(value);
        if (role && roleWordLine(value, options.isName))
            return roleOfWord(role[2]) === 'author';
        return isPersonShaped(value) || (HANGUL.test(value) && !!options.isName && options.isName(value));
    };
    const authorBelow = nameShaped && chosen.end === blocks[chosen.at].end && (() => {
        for (const block of blocks.slice(chosen.at + 1)) {
            if ((block.kind === 'byline' && (!block.role || block.role === 'author'))
                || (block.kind === 'text' && block.lines.length <= 3 && block.lines.every(authorLine)))
                return true;
            if (block.kind !== 'text')
                return false;
        }
        return false;
    })();
    if (opener !== null && (rubric || (nameShaped && !authorBelow))) {
        const below = candidates.slice(1, 3).find(entry => {
            const joined = joinTitleLines(entry.lines);
            if (DATE_ONLY.test(joined) || looksLikeCode(joined) || PAGE_FURNITURE.test(joined))
                return false;
            if (entry.lines.every(line => isPersonShaped(line)))
                return false;
            if (blocks.slice(chosen.at + 1, entry.at).some(block => block.kind === 'institution'))
                return false;
            return joined.length >= 8;
        });
        if (below) {
            if (rubric)
                noteLabel(opener, chosen.start);
            else
                byline = opener;
            chosen = below;
        }
        else if (!rubric && chosen.end === blocks[chosen.at].end && !!blocks[chosen.at + 1]
            && (blocks[chosen.at + 1].kind === 'institution' || institutionLine(blocks[chosen.at + 1].lines[0] || '')))
            return none(label);
    }
    const head = compactLetters(joinTitleLines(chosen.lines));
    if (head.length >= 8) {
        for (const other of candidates.slice(1, 6)) {
            const body = compactLetters(joinTitleLines(other.lines));
            const shared = sharedPrefix(head, body);
            const addsWords = /\p{L}/u.test(body.slice(shared));
            if (shared >= Math.max(8, Math.ceil(head.length * 0.8))
                && body.length > head.length && addsWords && joinTitleLines(other.lines).length <= 140) {
                chosen = other;
                break;
            }
        }
    }
    let title = joinTitleLines(chosen.lines);
    let continued: string | null = null;
    if (titleEnding(title) === 'open') {
        const glyphRows = pageLines.filter(row => { const bare = row.replace(/\s+/g, ''); return !!bare && bare.length <= 6; });
        const spine = compactLetters(glyphRows.join(''));
        const head = compactLetters(title);
        const titleSize = sizeOf(chosen);
        const seatLine = (line: string) => dateStatement(line) || roleStatement(line) || institutionLine(line) || documentLabel(line) || CODE_LINE.test(line)
            || looksLikeCode(line) || PAGE_FURNITURE.test(line) || personLine(line, options.isName) || !!spacedHangulName(line, options.isName) || nameListRow(line, options.isName)
            || isOrganisationName(line);
        const titleRow = (row: number, line: string) => HANGUL.test(line) === HANGUL.test(title) && readableLine(line) && !furniture(line) && !sentenceLine(line)
            && !closesSentence(line) && compactLetters(line).length >= 2 && !head.includes(compactLetters(line)) && !(rowHeights && rotatedAt(row));
        let found: {
            line: string;
            row: number;
        } | null = null;
        scan: for (let at = chosen.at; at < blocks.length; at++) {
            const block = blocks[at];
            if (block.vertical)
                continue;
            if (firstProse >= 0 && block.start >= firstProse)
                break;
            const seatBlock = passableKinds.has(block.kind) || block.kind === 'byline' || block.kind === 'unreadable';
            if (!seatBlock && block.kind !== 'text')
                break;
            const filled: number[] = [];
            for (let row = block.start; row <= block.end; row++)
                if (pageLines[row]?.trim())
                    filled.push(row);
            for (const [offset, line] of block.lines.entries()) {
                const row = filled.length === block.lines.length ? filled[offset] : block.start + offset;
                if (row <= chosen.end)
                    continue;
                if (seatBlock || seatLine(line))
                    continue;
                if (titleRow(row, line))
                    found = { line, row };
                break scan;
            }
        }
        if (found) {
            const joined = compactLetters(`${title}${found.line}`);
            const sameDisplay = titleSize > 0 && displayed(titleSize) && sameSize(sizeAt(found.row), titleSize);
            const restated = spine.length > head.length && spine.includes(joined);
            const laterTitle = blocks.some(block => block.kind === 'text' && !block.vertical && block.start > found!.row && (firstProse < 0 || block.start < firstProse)
                && block.lines.some(line => !seatLine(line) && readableLine(line) && !furniture(line)));
            const onlyCandidate = !rowHeights && !laterTitle;
            if (sameDisplay || restated || onlyCandidate) {
                continued = found.line;
                title = joinTitleLines([title, found.line]);
                because.push({ signal: 'displaced', rows: [found.row], detail: sameDisplay ? 'sameDisplaySize' : restated ? 'restated' : 'onlyCandidate' });
            }
        }
    }
    const apart = editionApart(title);
    const edition = apart.edition;
    title = apart.title;
    const bylines: BylineNear[] = [];
    const passable = new Set<BlockKind>(['label', 'date', 'institution', 'role', 'code', 'furniture']);
    for (let at = chosen.at - 1; at >= 0 && chosen.at - at <= 3; at--) {
        const block = blocks[at];
        if (block.kind === 'byline') {
            bylines.push({ lines: block.lines, role: block.role, start: block.start, end: block.end, position: 'above' });
            break;
        }
        if (!passable.has(block.kind))
            break;
    }
    if (!bylines.length) {
        const affiliationRow = (line: string) => isResponsibilityRow(line) || institutionLine(line) || isInstitutionName(line) || isOrganisationName(line);
        const nameRow = (line: string) => personLine(line, options.isName) && !affiliationRow(line) && !isHardFurniture(line) && !isRubricLine(line)
            && !closesSentence(line) && !documentLabel(line);
        const plainRow = (line: string) => affiliationRow(line) || (!closesSentence(line) && !sentenceLine(line) && line.split(/\s+/).length <= 10 && !nameListRow(line, options.isName));
        const units: Array<{
            name: string;
            start: number;
            end: number;
        }> = [];
        let group: Array<{
            line: string;
            row: number;
        }> = [];
        const unitOf = (rows: Array<{
            line: string;
            row: number;
        }>) => rows.length >= 2 && nameRow(rows[0].line)
            && rows.slice(1).some(entry => affiliationRow(entry.line)) && rows.slice(1).every(entry => plainRow(entry.line));
        for (let row = chosen.start - 1; row >= -1; row--) {
            const raw = row >= 0 ? pageLines[row] ?? '' : '';
            if (row >= 0 && raw.trim()) {
                const columns = splitColumns(raw);
                if (columns.length !== 1)
                    break;
                group.unshift({ line: columns[0].trim(), row });
                continue;
            }
            if (!group.length) {
                if (row < 0)
                    break;
                continue;
            }
            if (!unitOf(group))
                break;
            units.unshift({ name: group[0].line, start: group[0].row, end: group[group.length - 1].row });
            group = [];
        }
        if (units.length) {
            bylines.push({ lines: units.map(unit => unit.name), start: units[0].start, end: units[units.length - 1].end, position: 'above' });
            because.push({ signal: 'besideByline', rows: [units[0].start, units[units.length - 1].end], detail: `${units.length} author units above` });
        }
    }
    let underSchool = false, pastSubtitle = false;
    let subtitle: {
        text: string;
        rows: number[];
        boundary: string;
    } | null = null;
    for (let at = chosen.at + 1; at < blocks.length && at - chosen.at <= 8; at++) {
        const block = blocks[at];
        if (block.kind === 'byline') {
            bylines.push({ lines: block.lines, role: block.role, start: block.start, end: block.end, position: 'below' });
            break;
        }
        if (block.kind === 'institution') {
            underSchool = true;
            continue;
        }
        if (passable.has(block.kind))
            continue;
        if (block.kind === 'text') {
            const parallel = block.lines.length <= 3 && HANGUL.test(block.lines.join(' ')) !== HANGUL.test(title);
            if (parallel && !underSchool)
                continue;
            if (at === chosen.at + 1 && !pastSubtitle && candidates.some(entry => entry.at === at)
                && !block.lines.every(line => personLine(line, options.isName))) {
                pastSubtitle = true;
                const rows: number[] = [];
                for (let row = block.start; row <= block.end; row++)
                    if (pageLines[row]?.trim())
                        rows.push(row);
                const smaller = sizeOf(block) > 0 && sizeOf(chosen) > 0 && sizeOf(block) < sizeOf(chosen) && !sameSize(sizeOf(block), sizeOf(chosen));
                subtitle = { text: joinTitleLines(block.lines), rows, boundary: smaller ? 'smallerBelow' : 'nextBlock' };
                continue;
            }
            if (underSchool && block.lines.length === 1 && spacedHangulName(block.lines[0], options.isName)) {
                bylines.push({ lines: block.lines, role: 'author', start: block.start, end: block.end, position: 'below' });
                break;
            }
            if ((underSchool || pastSubtitle) && block.lines.length === 1 && isPersonShaped(block.lines[0])) {
                bylines.push({ lines: block.lines, role: 'author', start: block.start, end: block.end, position: 'below' });
            }
        }
        break;
    }
    if (namesAbove && !bylines.some(entry => entry.position === 'above'))
        bylines.push({ ...namesAbove, position: 'above' });
    const labelAbove = labelsSeen.filter(entry => entry.row < chosen.start).sort((a, b) => a.row - b.row)[0];
    if (labelAbove)
        label = labelAbove.text;
    else {
        const below = labelsSeen.find(entry => entry.text === label && entry.row > chosen.end);
        const opened = below ? candidateAt.get(filledAfter(below.row)?.at ?? -1) : undefined;
        if (opened && opened.start !== chosen.start && !namesOnly(opened))
            label = null;
    }
    const seated = seeded || stated > 0 || bylines.length > 0 || bylineNear(chosen) || blocks[chosen.at + 1]?.kind === 'label' || blocks[chosen.at - 1]?.kind === 'label';
    if (seated && !because.some(entry => entry.signal === 'display'))
        because.push({ signal: bylines.length || bylineNear(chosen) ? 'besideByline' : 'shape', rows: [chosen.start, chosen.end] });
    return { title, lines: continued ? [...chosen.lines, continued] : chosen.lines, label, edition, byline, blocks: blocks.length,
        block: { index: chosen.at, start: chosen.start, end: chosen.end }, structure, bylines,
        ...(continued ? { continued: 'displaced' as const } : {}), parallels, because, height: sizeOf(chosen), seated, subtitle };
}
function editionApart(value: string): {
    title: string;
    edition: string | null;
} {
    const { TRAILING_EDITION, TRAILING_EDITION_KO, STATUTE_REFERENCE } = TITLE_LINE_SHAPES;
    let title = value, edition: string | null = null;
    const editionMatch = TRAILING_EDITION.exec(title) || TRAILING_EDITION_KO.exec(title);
    if (editionMatch && title.slice(0, editionMatch.index).trim().length >= 8) {
        edition = editionMatch[1] ? editionMatch[1].replace(/\s+/g, '') : editionMatch[0].trim();
        title = title.slice(0, editionMatch.index).replace(/[\s,·–—-]+$/, '').trim();
    }
    return { title: title.replace(STATUTE_REFERENCE, '').trim(), edition };
}
export function leadingCodeOf(s: PageStructure | null | undefined, title: unknown): {
    token: string;
    kept: boolean;
    because: 'ownCode' | 'titleWord';
} | null {
    const value = String(title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const space = value.indexOf(' ');
    if (space <= 0)
        return null;
    const token = value.slice(0, space);
    if (!codeToken(token))
        return null;
    const same = (code: string) => code === token || code.toUpperCase() === token.toUpperCase();
    const letters = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const phrase = letters(`${token}${value.slice(space + 1).split(' ')[0]}`);
    const restated = !!s && s.running.some(line => line.codes.some(same) && line.seen.some(entry => letters(entry.text).includes(phrase)));
    const own = !!s && codesOf(s).some(code => same(code.value) && !(restated && code.kind === 'part' && code.from.every(from => from === 'running')));
    return own ? { token, kept: false, because: 'ownCode' } : { token, kept: true, because: 'titleWord' };
}
export function withoutLeadingCode(s: PageStructure | null | undefined, title: string): string {
    const code = leadingCodeOf(s, title);
    return code && !code.kept ? String(title).normalize('NFKC').replace(/\s+/g, ' ').trim().slice(code.token.length).trim() : title;
}
interface PageReading {
    page: number;
    reading: 'layer' | 'ocr';
    text: string;
    layout?: string;
    lineHeights?: number[];
    degraded?: boolean;
    glyphRisk?: boolean;
    width: number | null;
    bodySize: number;
}
function pageReadingOf(s: PageStructure, page: number, reading: 'layer' | 'ocr'): PageReading | null {
    const rows = titleRowsOf(s, page, reading);
    if (!rows || rows.facts.reading !== reading)
        return null;
    const { rendering, width, bodySize } = rows.facts;
    return { page, reading, text: rendering.text, ...(rendering.layout !== undefined ? { layout: rendering.layout } : {}),
        ...(rendering.lineHeights ? { lineHeights: rendering.lineHeights } : {}), ...(rendering.degraded ? { degraded: true } : {}),
        ...(rendering.glyphRisk ? { glyphRisk: true } : {}), width, bodySize };
}
const nameInByline = (value: string) => isPersonalName(value);
const compactName = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function pageSettingOf(page: {
    text: string;
    layout?: string;
    lineHeights?: number[];
}) {
    const rendering = String(page.layout && String(page.layout).trim() ? page.layout : page.text).normalize('NFKC');
    const rows = rendering.split('\n');
    const filled = rows.map(row => row.trim()).filter(Boolean);
    const next = new Map<string, string>(), previous = new Map<string, string>();
    filled.forEach((row, at) => {
        if (at + 1 < filled.length && !next.has(row))
            next.set(row, filled[at + 1]);
        if (at > 0 && !previous.has(row))
            previous.set(row, filled[at - 1]);
    });
    const display = new Set<string>();
    const heights = Array.isArray(page.lineHeights) && page.lineHeights.length === rows.length ? page.lineHeights : null;
    if (heights) {
        const measured = heights.filter(value => value > 0).sort((a, b) => a - b);
        const median = measured[Math.floor(measured.length / 2)] || 0;
        const largest = measured[measured.length - 1] || 0;
        if (median && largest >= median * 1.3)
            rows.forEach((row, at) => { if (heights[at] === largest && row.trim())
                display.add(compactName(row)); });
    }
    return { foot: compactName(filled[filled.length - 1] || ''), display, next, previous };
}
function titleFurnitureOf(s: PageStructure, reading: PageReading, evidenceText: string): (line: string) => boolean {
    const setting = pageSettingOf(reading);
    const inFurnitureRegion = inRegionsOf(s, reading.page, ['acknowledgements', 'imprint', 'stamp']);
    const ofLine = (line: string) => isNotATitle(line) || isInstitutionName(line)
        || (isPublisherHouseName(line) && setting.foot === compactName(line))
        || looksLikeBodyProse(line)
        || (isPersonalName(line) && !setting.display.has(compactName(line)))
        || looksLikeNameList(line) || isOwnJournalName(line, evidenceText);
    const opensBracket = (line: string) => /\([^)]*$/.test(line);
    const closesBracket = (line: string) => /^[^(]*\)/.test(line);
    return (line: string) => {
        if (inFurnitureRegion(line))
            return true;
        const key = line.trim();
        const next = setting.next.get(key), previous = setting.previous.get(key);
        if (next && opensBracket(key) && closesBracket(next))
            return ofLine(`${key} ${next}`);
        if (previous && opensBracket(previous) && closesBracket(key))
            return ofLine(`${previous} ${key}`);
        return ofLine(line);
    };
}
export function readPageTitleBlock(text: unknown, furniture: (line: string) => boolean, options: Parameters<typeof readTitleBlock>[2] = {}): ReturnType<typeof readTitleBlock> {
    if (options.masthead === undefined || options.bodySize === undefined) {
        const layout = String(options.layout ?? '').normalize('NFKC');
        const one = readPageStructure({ pages: [{ page: 1, layer: { text: String(text ?? '').normalize('NFKC'), ...(layout.trim() ? { layout } : {}),
                        ...(Array.isArray(options.lineHeights) && options.lineHeights.length ? { lineHeights: options.lineHeights } : {}) } }] });
        const facts = titleRowsOf(one, 1)?.facts;
        options = { ...options, ...(options.masthead === undefined ? { masthead: facts?.masthead ?? null } : {}),
            ...(options.bodySize === undefined && facts?.bodySize ? { bodySize: facts.bodySize } : {}) };
    }
    return readTitleBlock(text, furniture, options);
}
export type TitlePart = 'main' | 'subtitle' | 'parallel' | 'designator' | 'rubric' | 'series' | 'label' | 'byline' | 'responsibility' | 'restatement' | 'head';
export interface TitleLine {
    row: number;
    text: string;
    part: TitlePart;
    height: number;
}
export interface Designator {
    kind: 'volume' | 'edition' | 'annex' | 'code';
    text: string;
    value: string;
    row: number;
    codeKind?: 'documentNumber' | 'part';
}
export interface TitleBlock {
    page: number;
    reading: 'layer' | 'ocr';
    basis: 'layout' | 'shape';
    main: {
        text: string;
        lines: string[];
        rows: number[];
    };
    subtitle: {
        text: string;
        rows: number[];
        boundary: string;
    } | null;
    parallel: Array<{
        text: string;
        rows: number[];
        script: 'hangul' | 'latin' | 'cjk';
    }>;
    designators: Designator[];
    rubric: TitleLine | null;
    series: TitleLine | null;
    label: TitleLine | null;
    bylines: Array<{
        rows: [
            number,
            number
        ];
        lines: string[];
        position: 'above' | 'below';
        role?: BylineRole;
    }>;
    seats: {
        degree?: number[];
        school?: number[];
        department?: number[];
        advisor?: number[];
        author?: number[];
        date?: number[];
    };
    lines: TitleLine[];
    endsOpen: boolean;
    leadingCode: {
        token: string;
        kept: boolean;
        because: 'ownCode' | 'codeApart' | 'titleWord';
    } | null;
    because: Array<{
        signal: string;
        rows?: number[];
        detail?: string;
    }>;
    strength: 0 | 1 | 2 | 3;
    read: ReturnType<typeof readTitleBlock>;
}
export interface DocumentTitle {
    block: TitleBlock | null;
    title: string;
    other: string | null;
    echoes: number[];
    fuller: {
        page: number;
        rows: number[];
    } | null;
    because: TitleBlock['because'];
    source: Record<string, any>;
}
function bigramDice(a: string, b: string): number {
    const pairs = (value: string) => {
        const letters = compactName(value), out = new Map<string, number>();
        for (let at = 0; at + 1 < letters.length; at++)
            out.set(letters.slice(at, at + 2), (out.get(letters.slice(at, at + 2)) || 0) + 1);
        return { out, size: Math.max(0, letters.length - 1) };
    };
    const left = pairs(a), right = pairs(b);
    if (!left.size || !right.size)
        return 0;
    let shared = 0;
    for (const [pair, count] of left.out)
        shared += Math.min(count, right.out.get(pair) || 0);
    return (2 * shared) / (left.size + right.size);
}
const scriptOf = (value: string): 'hangul' | 'latin' | 'cjk' => /[가-힣]/.test(value) ? 'hangul'
    : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : 'latin';
function titleBlockFrom(read: ReturnType<typeof readTitleBlock>, reading: PageReading, s: PageStructure): TitleBlock | null {
    if (!read.block || !read.title)
        return null;
    const { end } = read.block;
    const rendering = String(reading.layout && String(reading.layout).trim() ? reading.layout : reading.text).split('\n');
    const rowsByKey = new Map<string, number[]>();
    for (const row of rowsOf(s, reading.page, reading.reading)) {
        const key = compactName(row.text);
        if (!key)
            continue;
        const held = rowsByKey.get(key);
        if (held)
            held.push(row.row);
        else
            rowsByKey.set(key, [row.row]);
    }
    const rowOfText = (text: string, after: number): number => {
        const found = rowsByKey.get(compactName(text))?.find(row => row > after);
        return found ?? -1;
    };
    const rowOfReaderRow = (row: number) => rendering[row]?.trim() ? rowOfText(rendering[row], -1) : -1;
    let cursor = -1;
    const lineRows = read.lines.map(text => { const at = rowOfText(text, cursor); if (at >= 0)
        cursor = at; return at; });
    const rows = lineRows.filter(row => row >= 0);
    const basis = String(reading.layout ?? '').trim() && Array.isArray(reading.lineHeights) && reading.lineHeights.length ? 'layout' as const : 'shape' as const;
    const lines: TitleLine[] = read.lines.map((text, at) => ({ row: lineRows[at], text, part: 'main' as TitlePart, height: read.height || 0 }));
    const labelPart: TitlePart | null = read.label ? (isRubricLine(read.label) ? 'rubric' : scriptOf(read.label) !== scriptOf(read.title) ? 'parallel' : 'label') : null;
    const label = read.label && labelPart ? { row: -1, text: read.label, part: labelPart, height: 0 } : null;
    if (label)
        lines.unshift(label);
    const bylines = read.bylines.map(entry => ({ rows: [rowOfReaderRow(entry.start), rowOfReaderRow(entry.end)] as [
            number,
            number
        ], lines: entry.lines,
        position: entry.position === 'above' ? 'above' as const : 'below' as const, ...(entry.role ? { role: entry.role } : {}) }));
    for (const entry of bylines)
        for (const text of entry.lines)
            lines.push({ row: entry.rows[0], text, part: 'byline', height: 0 });
    const parallel = (read.parallels || []).map(text => ({ text, rows: [] as number[], script: scriptOf(text) }));
    if (label && label.part === 'parallel' && !parallel.some(entry => compactName(entry.text) === compactName(label.text)))
        parallel.push({ text: label.text, rows: [], script: scriptOf(label.text) });
    for (const entry of parallel)
        if (!lines.some(line => line.part === 'parallel' && compactName(line.text) === compactName(entry.text)))
            lines.push({ row: -1, text: entry.text, part: 'parallel', height: 0 });
    const subtitle = read.subtitle ? { text: read.subtitle.text, rows: read.subtitle.rows.map(rowOfReaderRow).filter(row => row >= 0), boundary: read.subtitle.boundary } : null;
    if (subtitle)
        lines.push({ row: subtitle.rows[0] ?? -1, text: subtitle.text, part: scriptOf(subtitle.text) === scriptOf(read.title) ? 'subtitle' : 'parallel', height: 0 });
    const designators: Designator[] = read.edition ? [{ kind: 'edition', text: read.edition, value: read.edition, row: rowOfReaderRow(end) }] : [];
    return {
        page: reading.page, reading: reading.reading, basis,
        main: { text: read.title, lines: read.lines, rows },
        subtitle: subtitle && scriptOf(subtitle.text) === scriptOf(read.title) ? subtitle : null, parallel, designators,
        rubric: label && label.part === 'rubric' ? label : null, series: null, label: label && label.part === 'label' ? label : null,
        bylines, seats: {}, lines,
        endsOpen: titleEnding(read.title) === 'open',
        leadingCode: leadingCodeOf(s, read.title),
        because: read.because || [],
        strength: (titleRowsOf(s, reading.page, reading.reading)?.facts.strength ?? 0) as 0 | 1 | 2 | 3,
        read
    };
}
const runningFacts = new WeakMap<PageStructure, {
    heads: Set<string>;
    neighbours: Map<string, Array<Set<string>>>;
}>();
function runningFactsOf(s: PageStructure) {
    let held = runningFacts.get(s);
    if (!held) {
        held = { heads: runningKeys(s, ['runningHead', 'runningFoot', 'masthead']), neighbours: runningNeighbours(s) };
        runningFacts.set(s, held);
    }
    return held;
}
function readOnce(s: PageStructure, reading: PageReading, options: {
    skipAt?: Set<number>;
    script?: 'hangul' | 'latin';
    bodyScript?: 'hangul' | 'latin' | null;
    evidence: string;
}) {
    const furniture = titleFurnitureOf(s, reading, options.evidence);
    const masthead = mastheadFor(s, reading.page, { text: reading.text, layout: reading.layout, lineHeights: reading.lineHeights });
    return readPageTitleBlock(reading.text, furniture, { layout: reading.layout, isName: nameInByline, lineHeights: reading.lineHeights, skipAt: options.skipAt,
        runningHeads: runningFactsOf(s).heads, runningNeighbours: runningFactsOf(s).neighbours, script: options.script, masthead,
        bodySize: reading.bodySize || undefined, width: reading.width, bodyScript: options.bodyScript ?? null });
}
function defaultOrder(s: PageStructure): Array<{
    page: number;
    reading: 'layer' | 'ocr';
}> {
    return s.pages.flatMap(entry => readingsOf(s, entry.page).map(reading => ({ page: entry.page, reading })));
}
function frontReadings(s: PageStructure, order: Array<{
    page: number;
    reading: 'layer' | 'ocr';
}>): PageReading[] {
    const roleAt = (page: number) => { const entry = s.pages.find(held => held.page === page); return entry ? legacyRole(entry) : ''; };
    const openingPage = s.opening.page;
    const openingEnd = openingPage !== null && s.opening.afterLeaves ? Math.max(3, openingPage + 2) : 3;
    const readings = order.map(entry => pageReadingOf(s, entry.page, entry.reading)).filter((entry): entry is PageReading => !!entry);
    const opening = readings.filter(entry => entry.page <= openingEnd);
    const roled = ['cover', 'titlePage', 'platformCover', 'submission', 'approval', 'colophon'].flatMap(role => readings.filter(entry => roleAt(entry.page) === role));
    const front = [...new Set([...opening, ...roled])].sort((a, b) => a.page - b.page);
    return front.filter(entry => !entry.degraded && roleAt(entry.page) !== 'platformCover');
}
const evidenceTexts = new WeakMap<PageStructure, string>();
function evidenceOf(s: PageStructure): string {
    let held = evidenceTexts.get(s);
    if (held === undefined) {
        held = frontReadings(s, defaultOrder(s)).map(entry => entry.text).join('\n\f\n');
        evidenceTexts.set(s, held);
    }
    return held;
}
const blockCache = new WeakMap<PageStructure, Map<string, TitleBlock | null>>();
export function titleBlockOf(s: PageStructure, page: number, reading?: 'layer' | 'ocr', options: {
    bodyScript?: 'hangul' | 'latin' | null;
} = {}): TitleBlock | null {
    const kind = reading ?? readingsOf(s, page)[0];
    if (!kind)
        return null;
    let held = blockCache.get(s);
    if (!held) {
        held = new Map();
        blockCache.set(s, held);
    }
    const key = `${page}\u0000${kind}\u0000${options.bodyScript ?? ''}`;
    if (held.has(key))
        return held.get(key) ?? null;
    const read = pageReadingOf(s, page, kind);
    const block = read ? titleBlockFrom(readOnce(s, read, { bodyScript: options.bodyScript, evidence: evidenceOf(s) }), read, s) : null;
    held.set(key, block);
    return block;
}
export function titleBlocksOf(s: PageStructure, options: {
    bodyScript?: 'hangul' | 'latin' | null;
} = {}): TitleBlock[] {
    const out: TitleBlock[] = [];
    for (const order of [0, 1, 2] as const) {
        for (const entry of s.pages) {
            if (titleOrder(s, entry.page) !== order)
                continue;
            for (const reading of readingsOf(s, entry.page)) {
                const block = titleBlockOf(s, entry.page, reading, options);
                if (block)
                    out.push(block);
            }
        }
    }
    return out;
}
export function documentTitle(s: PageStructure, options: {
    bodyScript?: 'ko' | 'ja' | 'zh' | 'latin' | 'hangul' | null;
    order?: Array<{
        page: number;
        reading: 'layer' | 'ocr';
    }>;
    restatements?: boolean;
} = {}): DocumentTitle | null {
    const bodyScript = options.bodyScript === 'hangul' ? 'ko' : options.bodyScript ?? null;
    const wantsHangul = bodyScript !== 'latin';
    const fitsBody = (title: unknown) => /[가-힣]/.test(String(title || '')) === wantsHangul;
    const roleAt = (page: number) => { const entry = s.pages.find(held => held.page === page); return entry ? legacyRole(entry) : ''; };
    const readable = frontReadings(s, options.order ?? defaultOrder(s));
    const evidenceText = readable.map(entry => entry.text).join('\n\f\n');
    const leafOfRole = (entry: PageReading) => roleAt(entry.page) === 'approval' || roleAt(entry.page) === 'submission';
    const titleReadable = readable.filter(entry => !mostlyRegion(s, entry.page, 'otherWorks'));
    const titleSources = [...titleReadable.filter(entry => !leafOfRole(entry)), ...titleReadable.filter(leafOfRole)];
    let chosen: Record<string, any> | null = null;
    let chosenBlock: TitleBlock | null = null;
    for (const page of titleSources) {
        const value = labelledTitle(page.text);
        if (!value)
            continue;
        chosen = { title: value, from: 'labelledField', page: page.page, label: null, lines: 1, blockLines: [value], glyphRisk: !!page.glyphRisk };
        break;
    }
    const bodyAs = bodyScript === 'latin' ? 'latin' as const : bodyScript ? 'hangul' as const : null;
    if (chosen && chosen.from === 'labelledField') {
        const head = compactName(chosen.title);
        for (const page of titleSources) {
            if (titleOrder(s, page.page) !== 0 || page.page === Number(chosen.page))
                continue;
            const block = readOnce(s, page, { bodyScript: bodyAs, evidence: evidenceText });
            const whole = compactName(block.title);
            if (!block.block || head.length < 4 || whole.length <= head.length || !whole.startsWith(head) || !/\p{L}/u.test(whole.slice(head.length)))
                continue;
            chosen = { title: block.title, from: 'titleBlock', page: page.page, label: block.label, lines: block.lines.length, blockLines: block.lines, edition: block.edition,
                ...(block.continued ? { continued: block.continued } : {}), byline: block.byline, glyphRisk: !!page.glyphRisk, block: block.block, structure: block.structure, bylines: block.bylines };
            chosenBlock = titleBlockFrom(block, page, s);
            chosenBlock?.because.push({ signal: 'fuller', rows: chosenBlock.main.rows, detail: `labelled field on page ${page.page} is its head` });
            break;
        }
    }
    const acceptedAsTitle = (block: ReturnType<typeof readTitleBlock>, page: PageReading) => {
        const cjkTitle = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(block.title || '');
        const floor = cjkTitle ? TITLE.floor.reading.cjk : block.seated ? 0 : TITLE.floor.reading.latin;
        const longestWord = Math.max(0, ...String(block.title || '').split(/\s+/).map(word => (word.match(/\p{L}/gu) || []).length));
        const seatedShort = !cjkTitle && !!block.seated && longestWord < TITLE.floor.seated;
        const region = block.block ? block.structure[block.block.index] : null;
        const rowsOfPage = String(page.layout && String(page.layout).trim() ? page.layout : page.text).normalize('NFKC').split('\n');
        const droppedHead = region && block.block && block.block.start > region.start
            ? rowsOfPage.slice(region.start, block.block.start).map(line => line.trim()).filter(Boolean) : [];
        const bodyCutShort = !!(droppedHead.length && block.title && isBodyNameOnly([...droppedHead, block.title].join(' ')));
        const accepted = !!block.title && block.title.length >= floor && !seatedShort && !isNotAFinishedTitle(block.title) && !looksLikeBodyProse(block.title) && !bodyCutShort
            && !runningHead(block.title) && !isOwnJournalName(block.title, page.text) && !isBylineRow(block.title, nameInByline);
        return { accepted, bodyCutShort };
    };
    for (const page of chosen ? [] : titleSources) {
        const skipped = new Set<number>();
        for (let attempt = 0; attempt < 4; attempt++) {
            const script = chosen && !fitsBody(chosen.title) ? (wantsHangul ? 'hangul' as const : 'latin' as const) : undefined;
            const block = readOnce(s, page, { skipAt: skipped, script, bodyScript: bodyAs, evidence: evidenceText });
            const { accepted, bodyCutShort } = acceptedAsTitle(block, page);
            if (accepted) {
                const titleBearing = !!chosen && (page.page === Number(chosen.page) || roleAt(page.page) === 'cover' || roleAt(page.page) === 'titlePage');
                const replaces = !!chosen && !fitsBody(chosen.title) && fitsBody(block.title) && !leafOfRole(page)
                    && (titleBearing || (!wantsHangul && page.page - Number(chosen.page ?? page.page) <= 1));
                if (!chosen || replaces) {
                    chosen = {
                        title: block.title, from: 'titleBlock', page: page.page, label: block.label,
                        lines: block.lines.length, blockLines: block.lines, edition: block.edition, ...(block.continued ? { continued: block.continued } : {}),
                        byline: block.byline, glyphRisk: !!page.glyphRisk,
                        block: block.block, structure: block.structure, bylines: block.bylines
                    };
                    chosenBlock = titleBlockFrom(block, page, s);
                }
                if (fitsBody(chosen?.title))
                    break;
                continue;
            }
            if (!block.block && block.label && !chosen) {
                const rubric = rubricOverACitedWork(page, String(block.label));
                if (rubric) {
                    chosen = { title: rubric.rubric, from: 'rubric', page: page.page, label: null, lines: 1, blockLines: [rubric.rubric], citedWork: rubric.cited, glyphRisk: !!page.glyphRisk };
                    break;
                }
            }
            if (!block.block)
                break;
            const wholePhraseOnly = !!block.title && isNotAFinishedTitle(block.title) && !isNotATitle(block.title);
            if (!wholePhraseOnly && !bodyCutShort)
                break;
            skipped.add(block.block.index);
        }
        if (chosen && fitsBody(chosen.title))
            break;
    }
    const continuedBelow = (reading: PageReading | undefined, block: {
        end: number;
    } | undefined, rest: string[]): boolean => {
        if (!reading || !block || !rest.length)
            return false;
        const rows = String(reading.layout && String(reading.layout).trim() ? reading.layout : reading.text).normalize('NFKC').split('\n');
        const heights = Array.isArray(reading.lineHeights) && reading.lineHeights.length === rows.length ? reading.lineHeights.map(Number) : null;
        const headHeight = heights ? heights[block.end] || 0 : 0;
        const wanted = rest.join('');
        let collected = '';
        for (let row = block.end + 1; row < rows.length && row <= block.end + 6 && collected.length < wanted.length; row++) {
            const line = compactName(rows[row]);
            if (!line)
                continue;
            if (heights && headHeight > 0 && !(Math.abs((heights[row] || 0) - headHeight) <= Math.max(heights[row] || 0, headHeight) * TITLE.sameSize))
                return false;
            collected += line;
        }
        return collected === wanted;
    };
    if (chosen && chosen.from === 'titleBlock') {
        const words = (value: unknown) => String(value || '').split(/\s+/).map(compactName).filter(Boolean);
        const head = words(chosen.title);
        const chosenReading = titleSources.find(entry => entry.page === Number(chosen!.page) && entry.reading === (chosenBlock?.reading ?? entry.reading));
        for (const page of titleSources) {
            if (head.join('').length < 4 || titleOrder(s, page.page) !== 0 || page.page === Number(chosen.page) || leafOfRole(page))
                continue;
            const block = readOnce(s, page, { bodyScript: bodyAs, evidence: evidenceText });
            const whole = words(String(block.title || '').replace(/[(（[][^)）\]\n]{0,40}[)）\]]/gu, ' '));
            if (!block.block || !block.seated || whole.length <= head.length || head.some((word, at) => whole[at] !== word) || !fitsBody(block.title))
                continue;
            if (!continuedBelow(chosenReading, chosen.block, whole.slice(head.length)))
                continue;
            if (!acceptedAsTitle(block, page).accepted)
                continue;
            chosen = { title: block.title, from: 'titleBlock', page: page.page, label: block.label, lines: block.lines.length, blockLines: block.lines, edition: block.edition,
                ...(block.continued ? { continued: block.continued } : {}), byline: block.byline, glyphRisk: !!page.glyphRisk, block: block.block, structure: block.structure, bylines: block.bylines };
            chosenBlock = titleBlockFrom(block, page, s);
            chosenBlock?.because.push({ signal: 'fuller', rows: chosenBlock.main.rows, detail: `the title read first is the head of page ${page.page}'s title` });
            break;
        }
    }
    if (!chosen || (chosen.from === 'titleBlock' && titleOrder(s, Number(chosen.page)) !== 0)) {
        for (const page of titleSources) {
            if (page.reading !== 'layer')
                continue;
            const stated = colophonTitleOf(s, page.page);
            if (!stated || !fitsBody(stated.title))
                continue;
            chosen = { title: stated.title, from: 'colophon', page: page.page, label: null, lines: 1, blockLines: [stated.title], glyphRisk: !!page.glyphRisk, rows: stated.rows };
            chosenBlock = null;
            break;
        }
    }
    const chosenReading = titleSources.find(entry => entry.page === Number(chosen?.page) && entry.reading === (chosenBlock?.reading ?? entry.reading))?.reading;
    if (options.restatements && chosen && chosen.from === 'titleBlock' && !chosenBlock?.read.seated) {
        const sameScript = /[가-힣]/.test(String(chosen.title)) ? 'hangul' as const : 'latin' as const;
        const seen = titleSources.filter(page => page.reading === chosenReading && (page.page !== Number(chosen!.page) || page.reading === chosenBlock?.reading))
            .map(page => ({ page, block: readOnce(s, page, { script: sameScript, bodyScript: bodyAs, evidence: evidenceText }) }))
            .filter(entry => !!entry.block.block && acceptedAsTitle(entry.block, entry.page).accepted);
        const echoes = (title: string, page: number) => seen.filter(entry => entry.page.page !== page && sameTitle(entry.block.title, title)).length;
        const alike = seen.filter(entry => compactName(entry.block.title).length >= 12 && fitsBody(entry.block.title) === fitsBody(chosen!.title)
            && TITLE_LINE_SHAPES.lettersAlike(entry.block.title, String(chosen!.title)));
        const agreement = (title: string) => alike.reduce((total, entry) => total + bigramDice(entry.block.title, title), 0);
        const central = alike.length >= 3 && !echoes(String(chosen.title), Number(chosen.page))
            ? alike.reduce((best, entry) => agreement(entry.block.title) > agreement(best.block.title) ? entry : best) : null;
        if (central && central.page.page !== Number(chosen.page) && agreement(central.block.title) > agreement(String(chosen.title))) {
            const block = central.block, page = central.page;
            chosen = { title: block.title, from: 'titleBlock', page: page.page, label: block.label, lines: block.lines.length, blockLines: block.lines, edition: block.edition,
                ...(block.continued ? { continued: block.continued } : {}), byline: block.byline, glyphRisk: !!page.glyphRisk, block: block.block, structure: block.structure, bylines: block.bylines };
            chosenBlock = titleBlockFrom(block, page, s);
            chosenBlock?.because.push({ signal: 'echo', rows: chosenBlock.main.rows, detail: `central of ${alike.length} alike statements` });
        }
        else if (!echoes(String(chosen.title), Number(chosen.page))) {
            const better = seen.find(entry => entry.page.page !== Number(chosen!.page) && [0, 1].includes(titleOrder(s, entry.page.page) ?? -1)
                && fitsBody(entry.block.title) === fitsBody(chosen!.title) && echoes(entry.block.title, entry.page.page) > 0);
            if (better) {
                const block = better.block, page = better.page;
                chosen = { title: block.title, from: 'titleBlock', page: page.page, label: block.label, lines: block.lines.length, blockLines: block.lines, edition: block.edition,
                    ...(block.continued ? { continued: block.continued } : {}), byline: block.byline, glyphRisk: !!page.glyphRisk, block: block.block, structure: block.structure, bylines: block.bylines };
                chosenBlock = titleBlockFrom(block, page, s);
                chosenBlock?.because.push({ signal: 'echo', rows: chosenBlock.main.rows, detail: `${echoes(block.title, page.page)} other front page(s)` });
            }
        }
    }
    if (chosen && chosen.from === 'titleBlock' && chosen.label && chosen.block) {
        const entryPage = titleSources.find(entry => entry.page === chosen!.page);
        const rubric = entryPage ? rubricOverACitedWork(entryPage, String(chosen.label)) : null;
        if (rubric) {
            chosen = { title: rubric.rubric, from: 'rubric', page: chosen.page, label: null, lines: 1, blockLines: [rubric.rubric], citedWork: rubric.cited, glyphRisk: !!entryPage?.glyphRisk };
            chosenBlock = null;
        }
    }
    if (!chosen)
        return null;
    const title = stripTitleNoise(withoutLeadingCode(s, String(chosen.title).replace(/\p{Co}+/gu, ''))).trim();
    return { block: chosenBlock, title, other: chosenBlock?.parallel[0]?.text ?? null, echoes: [], fuller: null, because: chosenBlock?.because ?? [], source: chosen };
}
const RIGHTS_NAMING_THE_WORK = /^(\S.{0,79}?)[^\S\n]*(?:©|ⓒ|Ⓒ|\([cC]\))[^\S\n]*([^,\n]{1,60}),[^\S\n]*(?:1[5-9]|20)\d{2}[^\S\n]*\.?$/u;
const COLOPHON_HEAD_CHARS = 80;
export function colophonTitleOf(s: PageStructure, page: number): {
    title: string;
    rows: number[];
} | null {
    const rows = rowsOf(s, page, 'layer');
    if (!rows.length)
        return null;
    const textAt = (row: number) => String(rows.find(entry => entry.row === row)?.text ?? '').replace(/\s+/g, ' ').trim();
    const shapedAsATitle = (value: string) => !!value && value.length <= COLOPHON_HEAD_CHARS && (value.match(/[\p{L}]/gu) || []).length >= 2
        && !imprintMark(value) && !closesSentence(value) && !/[.!?。]$/.test(value) && !isNotATitle(value) && !looksLikeBodyProse(value);
    for (const region of regionsOf(s, page, ['imprint']).filter(entry => entry.basis === 'text')) {
        const [first, last] = region.rows;
        let named: {
            title: string;
            row: number;
        } | null = null;
        for (let row = first; row <= last && !named; row++) {
            const found = RIGHTS_NAMING_THE_WORK.exec(textAt(row));
            const work = found ? found[1].trim() : '';
            if (work && shapedAsATitle(work) && compactName(work) !== compactName(found![2]))
                named = { title: work, row };
        }
        const headEntry = rows.filter(entry => entry.row < first && String(entry.text || '').trim()).pop();
        const head = headEntry && !headEntry.prose && !headEntry.region && headEntry.row >= first - 1 && shapedAsATitle(textAt(headEntry.row))
            ? { title: textAt(headEntry.row), row: headEntry.row } : null;
        if (named && head) {
            const headWords = head.title.split(/\s+/).map(compactName), nameWords = named.title.split(/\s+/).map(compactName);
            if (nameWords.every((word, at) => headWords[at] === word))
                return { title: named.title, rows: [head.row, named.row] };
        }
        if (named)
            return { title: named.title, rows: [named.row] };
    }
    return null;
}
const TITLE_LABEL = /^\s*(?:\(\d+\)\s*)?(제\s*목|과\s*제\s*명|연구\s*과\s*제\s*명|보\s*고\s*서\s*명|(?:특허\s*)?기\s*술\s*명|발\s*명\s*(?:\(\s*고\s*안\s*\)\s*)?의\s*(?:(국|한|영)\s*(?:문|글)\s*)?명\s*칭|논\s*문\s*(?:제\s*목|명))\s*(\((?:한\s*글|국\s*문|영\s*문|English)\))?\s*[:：]?\s*(.*)$/i;
export function labelledTitle(pageText: string): string | null {
    const lines = String(pageText || '').normalize('NFKC').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim());
    const found: Array<{
        value: string;
        english: boolean;
    }> = [];
    for (let i = 0; i < lines.length && i < 80; i++) {
        const match = TITLE_LABEL.exec(lines[i]);
        if (!match)
            continue;
        let english = /영\s*문|English/i.test(match[3] || '') || match[2] === '영';
        let value = (match[4] || lines[i + 1] || '').replace(/\s*[{｛]\s*[A-Za-z][^}｝]*[}｝]?\s*$/u, '').trim();
        const subLabel = /^\(?\s*(한\s*글|국\s*문|영\s*문|English)\s*\)?\s*[:：]?\s*/i.exec(value);
        if (subLabel) {
            if (/영\s*문|English/i.test(subLabel[1]))
                english = true;
            value = value.slice(subLabel[0].length).trim();
        }
        if (!value || TITLE_LABEL.test(value))
            continue;
        const hangul = (value.match(/[가-힣]/g) || []).length, latin = (value.match(/[A-Za-z]/g) || []).length;
        if (hangul < 3 && latin < 8)
            continue;
        if (isNotATitle(value) || isPersonalName(value))
            continue;
        found.push({ value, english });
    }
    return (found.find(entry => !entry.english) || found[0])?.value || null;
}
function weldedLine(line: string): boolean {
    if (line.length < 25 || /\s/.test(line) || /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line))
        return false;
    return (line.match(/\p{Ll}\p{Lu}/gu) || []).length >= 2;
}
export function runningHead(value: unknown): boolean {
    const line = String(value || '').normalize('NFKC').trim();
    if (/^© ?\d{4}/.test(line))
        return true;
    if (weldedLine(line))
        return true;
    if (/\(\s*(?:1[5-9]|20)\d{2}\s*\)\s*\d{1,6}\s*[-–—]\s*\d{1,6}\s*$/.test(line))
        return true;
    if (/\b(?:1[5-9]|20)\d{2}\b[^\n]{0,20}\b\d{1,6}\s*[-–—]\s*\d{1,6}\s*$/.test(line) && line.length < 70)
        return true;
    if (/^\d{5,9}\b.*\(\s*\d+\s+of\s+\d+\s*\)/i.test(line))
        return true;
    if (/[�þÿ]/.test(line))
        return true;
    return false;
}
const PHYSICAL_DESCRIPTION = /(?:1[5-9]|20)\d{2}\s*[.,;]\s*(?:[xivlc]+,\s*)?\d{1,4}\s*pp?\.(?=[\s,;(]|$)/i;
const LISTING_DETAIL = /(?:US)?\$\s?\d|£\s?\d|€\s?\d|\bISBN\b|\b(?:hard|soft)cover\b|\bpaperback\b|\bcloth\b|\bedited\s+by\b|,\s*eds?\.(?=\s|$)/i;
export function citedWorkEntry(text: unknown): boolean {
    const value = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ');
    return PHYSICAL_DESCRIPTION.test(value) && LISTING_DETAIL.test(value);
}
function rubricOverACitedWork(page: {
    text: string;
    layout?: string;
    lineHeights?: number[];
}, label: string): {
    rubric: string;
    cited: string;
} | null {
    const rows = String(page.layout && String(page.layout).trim() ? page.layout : page.text).normalize('NFKC').split('\n');
    const key = compactName(label);
    if (!key)
        return null;
    const labelRow = rows.findIndex(row => compactName(row) === key);
    if (labelRow < 0)
        return null;
    const paragraph: string[] = [], paragraphRows: number[] = [];
    for (let at = labelRow + 1; at < rows.length && paragraph.length < 6; at++)
        if (rows[at].trim()) {
            paragraph.push(rows[at].trim());
            paragraphRows.push(at);
        }
    const cited = paragraph.join(' ');
    if (!citedWorkEntry(cited))
        return null;
    const heights = Array.isArray(page.lineHeights) && page.lineHeights.length === rows.length ? page.lineHeights : null;
    if (heights) {
        const measured = paragraphRows.map(at => Number(heights[at]) || 0).filter(value => value > 0).sort((a, b) => a - b);
        const paragraphSize = measured[Math.floor((measured.length - 1) / 2)] || 0;
        const rubricSize = Number(heights[labelRow]) || 0;
        if (!(paragraphSize > 0 && rubricSize > paragraphSize && Math.abs(rubricSize - paragraphSize) > rubricSize * TITLE.sameSize))
            return null;
    }
    else if (!isRubricLine(label) && (/\p{Ll}/u.test(label) || !/\p{Lu}.*\p{Lu}/u.test(label)))
        return null;
    return { rubric: rows[labelRow].replace(/\s+/g, ' ').trim(), cited: cited.slice(0, 160) };
}
export function writtenTitle(lines: string[]): {
    title: string;
    edition: string | null;
} {
    const split = editionApart(TITLE_LINE_SHAPES.joinTitleLines(lines));
    return { title: stripTitleNoise(split.title).trim(), edition: split.edition };
}
const sameLetters = (a: unknown, b: unknown) => { const x = compactName(a); return x.length >= 2 && x === compactName(b); };
const namesABodyLine = (text: unknown) => { const value = String(text ?? '').trim(); return !!value && (isInstitutionName(value) || isOrganisationOnly(value) || namesABodyNotAWork(value)); };
export function titleSeatOf(s: PageStructure, page: number, line: string): TitlePart | 'body' | 'masthead' | 'running' | RegionKind | null {
    const block = titleBlockOf(s, page);
    if (block) {
        if (block.main.lines.some(entry => sameLetters(entry, line)) || sameLetters(block.main.text, line))
            return 'main';
        const seat = block.lines.find(entry => entry.part !== 'main' && sameLetters(entry.text, line));
        if (seat)
            return seat.part;
    }
    const rows = titleRowsOf(s, page);
    const row = rows?.rows.find(entry => sameLetters(entry.text, line));
    if (!row)
        return null;
    if (row.seat)
        return row.seat;
    return row.prose ? 'body' : null;
}
export function printedAsTitle(s: PageStructure, value: unknown): {
    page: number;
    part: 'main' | 'subtitle' | 'parallel' | 'restatement' | 'running';
    rows: number[];
} | null {
    if (compactName(value).length < 2)
        return null;
    for (const block of titleBlocksOf(s)) {
        if (sameLetters(block.main.text, value) || sameLetters(TITLE_LINE_SHAPES.joinTitleLines(block.main.lines), value))
            return { page: block.page, part: 'main', rows: block.main.rows };
        const parallel = block.parallel.find(entry => sameLetters(entry.text, value));
        if (parallel)
            return { page: block.page, part: 'parallel', rows: parallel.rows };
        if (block.subtitle && sameLetters(block.subtitle.text, value))
            return { page: block.page, part: 'subtitle', rows: block.subtitle.rows };
    }
    for (const title of runningTitles(s))
        if (sameLetters(title, value))
            return { page: 0, part: 'running', rows: [] };
    return null;
}
export function continuationOf(s: PageStructure, value: unknown): {
    rest: string;
    page: number;
    rows: number[];
    whole: string;
    displaced: string | null;
} | null {
    const read = compactName(value);
    if (read.length < 4)
        return null;
    for (const block of titleBlocksOf(s)) {
        const lines = block.main.lines;
        const marked = new Map(block.basis === 'shape' ? (titleRowsOf(s, block.page, block.reading)?.rows ?? []).map(entry => [entry.row, entry]) : []);
        const mainRows = block.lines.filter(line => line.part === 'main').map(line => line.row);
        const titleLine = (at: number) => { const row = marked.get(mainRows[at]); return !row || (!row.byline && !row.prose); };
        let head = '';
        for (let at = 0; at + 1 < lines.length; at++) {
            head += compactName(lines[at]);
            if (head.length > read.length)
                break;
            if (head !== read)
                continue;
            let end = at + 1;
            while (end < lines.length && titleLine(end) && TITLE_LINE_SHAPES.joinTitleLines(lines.slice(0, end + 1)).length <= TITLE.maxChars)
                end++;
            if (end === at + 1)
                return null;
            const rest = TITLE_LINE_SHAPES.joinTitleLines(lines.slice(at + 1, end));
            const displaced = end === lines.length ? block.because.find(entry => entry.signal === 'displaced')?.detail ?? null : null;
            const restRows = mainRows.slice(at + 1, end).filter(row => row >= 0);
            return { rest, page: block.page, rows: restRows, whole: TITLE_LINE_SHAPES.joinTitleLines(lines.slice(0, end)), displaced };
        }
    }
    return null;
}
export function parallelOf(s: PageStructure, a: unknown, b: unknown): boolean {
    for (const block of titleBlocksOf(s)) {
        const texts = [block.main.text, ...block.parallel.map(entry => entry.text).filter(text => !namesABodyLine(text))];
        if (texts.some(text => sameLetters(text, a)) && texts.some(text => sameLetters(text, b)) && !sameLetters(a, b))
            return true;
    }
    return false;
}
function hangulBesidePrinted(s: PageStructure, record: unknown): string {
    const value = String(record ?? '').replace(/<[^>]+>|&#?\w+;/g, ' ');
    const target = compactName(value);
    if (target.length < TITLE.floor.printed.latin || /[가-힣]/.test(value))
        return '';
    for (const entry of s.pages) {
        if (titleOrder(s, entry.page) === null && entry.page > 2)
            continue;
        const held = titleRowsOf(s, entry.page);
        if (!held)
            continue;
        const rows = held.rows;
        const display = held.facts.bodySize > 0 ? held.facts.bodySize * TITLE.display : 0;
        const titleRow = (row: TitleRow) => /[가-힣]/.test(row.text) && !row.prose && !row.byline && !row.seat && !isRubricLine(row.text)
            && !TITLE_LINE_SHAPES.documentLabel(row.text) && !(display > 0 && row.height > 0 && row.height < display);
        const joins = (upper: TitleRow, lower: TitleRow) => lower.blanksBefore === 0 || (display > 0 && upper.height > 0 && lower.blanksBefore <= 1);
        for (let first = 0; first < rows.length; first++) {
            let joined = '', last = first;
            for (; last < rows.length && last - first < 6 && joined.length < target.length; last++) {
                if (last > first && rows[last].blanksBefore > 1)
                    break;
                joined += compactName(rows[last].text);
            }
            const head = compactName(rows[first].text).slice(0, 8), tail = compactName(rows[last - 1].text).slice(-8);
            if (joined !== target && !(target.startsWith(head) && target.endsWith(tail) && bigramDice(joined, target) >= 0.9))
                continue;
            const group: TitleRow[] = [];
            for (let at = first - 1; at >= 0 && group.length < 4; at--) {
                const below = rows[at + 1];
                if (!titleRow(rows[at]) || (group.length ? !joins(rows[at], below) : below.blanksBefore > 2))
                    break;
                group.unshift(rows[at]);
            }
            if (!group.length) {
                for (let at = last; at < rows.length && group.length < 4; at++) {
                    if (!titleRow(rows[at]) || (group.length ? !joins(group[group.length - 1], rows[at]) : rows[at].blanksBefore > 2))
                        break;
                    group.push(rows[at]);
                }
            }
            const text = TITLE_LINE_SHAPES.joinTitleLines(group.map(row => row.text));
            if (compactName(text).length < TITLE.floor.printed.cjk || isNotATitle(text) || looksLikeNameList(text) || isPersonalName(text.replace(/\s+/g, '')))
                continue;
            return text;
        }
    }
    return '';
}
export function koreanTitleBesideRecord(s: PageStructure, read: unknown, record: unknown): {
    title: string;
    because: 'parallel' | 'running' | 'adjacent' | 'claimed';
} | null {
    const reading = String(read ?? '').replace(/\s+/g, ' ').trim();
    const hangul = /[가-힣]/.test(reading);
    if (hangul && parallelOf(s, reading, record))
        return { title: reading, because: 'parallel' };
    if (hangul && TITLE_LINE_SHAPES.statedByRunningHead(runningKeys(s, ['runningHead']), reading))
        return { title: reading, because: 'running' };
    const own = compactName(reading);
    const isReading = (text: string) => { const printed = compactName(text); return hangul && !!printed && own.length >= TITLE.floor.printed.cjk && (printed.includes(own) || own.includes(printed)); };
    const beside = hangulBesidePrinted(s, record);
    if (beside)
        return isReading(beside) ? { title: reading, because: 'parallel' } : { title: beside, because: 'adjacent' };
    const claimed = hangul && s.pages.some(entry => !!entry.claim && !entry.claim.entry && entry.claim.strength >= 1 && titleOrder(s, entry.page) === 0
        && (sameTitle(entry.claim.title, reading) || isReading(hangulBesidePrinted(s, entry.claim.title))));
    return claimed ? { title: reading, because: 'claimed' } : null;
}
export function subtitleOf(s: PageStructure, title: unknown, stated: unknown): boolean {
    return titleBlocksOf(s).some(block => (sameLetters(block.main.text, title) || block.main.lines.some(line => sameLetters(line, title)))
        && !!block.subtitle && sameLetters(block.subtitle.text, stated));
}
export function readingCoverage(s: PageStructure, value: unknown): {
    page: number;
    rows: Array<{
        row: number;
        text: string;
        part: TitlePart | 'body' | 'other';
    }>;
} | null {
    const target = compactName(value);
    if (target.length < 20)
        return null;
    for (const entry of s.pages) {
        const rows = titleRowsOf(s, entry.page)?.rows;
        if (!rows)
            continue;
        for (let start = 0; start < rows.length; start++) {
            let joined = '', end = start;
            while (end < rows.length && joined.length < target.length) {
                joined += compactName(rows[end].text);
                end++;
            }
            if (!joined.startsWith(target) || end - start < 2)
                continue;
            return { page: entry.page, rows: rows.slice(start, end).map(row => {
                    const seat = titleSeatOf(s, entry.page, row.text);
                    const part: TitlePart | 'body' | 'other' = seat === 'body' ? 'body' : seat && ['main', 'subtitle', 'parallel', 'designator', 'rubric', 'series', 'label', 'byline', 'responsibility', 'restatement', 'head'].includes(seat) ? seat as TitlePart : 'other';
                    return { row: row.row, text: row.text, part };
                }) };
        }
    }
    return null;
}

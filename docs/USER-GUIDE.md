# Using PDF Metadata Refresh 1.0.0

## Find, review, apply

Select items with attached PDFs in Zotero and open the plugin from the item context menu. Use **Find PDF metadata** to check the whole job. Finding information creates proposals; it does not write item metadata.

Click an item or use **Review changes** to compare existing and proposed values. Check the items and individual fields you want to use, then choose **Apply selected changes**. Read the confirmation, including additions and values that will be cleared.

An item checkbox selects an item for an action. A field checkbox chooses a value for writing. A **Flag** checkbox only marks something to revisit. These are separate decisions. A selected item can still have no writable change.

Selections remain when you change the title query, filter or page. Apply includes eligible selected items hidden by the current view. The selection summary includes hidden selections so you can check the scope before applying.

## Find methods and settings

The methods run in the established recognition pipeline:

1. Zotero's PDF recognizer and identifiers printed in the PDF, such as DOI or ISBN.
2. Website and bibliographic catalogue lookup.
3. Optional page-image reading with a local LM Studio vision model. It may be followed by another lookup to corroborate the result.

Choose the methods you want in **Find methods and settings**. Image reading requires LM Studio, a vision-capable model and a running loopback server. Select the model there; disabling the model disables that reading path. PDF page rendering for this feature currently requires Windows.

The replacement setting can propose clearing older fields or creators absent from newly found information. Review those changes before applying. Changing the setting affects items read afterward; previously read items retain the setting used when their proposals were made.

## Read evidence and colours

The same colours appear in **More groups** and beside each item:

- Grey: pending, stopped or excluded items.
- Red: a processing, missing-file or PDF-reading problem.
- Orange: PDF reading, missing information or an attachment choice needs review.
- Yellow: catalogue or webpage results need review.
- Blue: work history such as a reread.
- Green: an identifier-based source or a completed application.

Colours indicate review priority, not permission to write. An identifier can locate a record without verifying every field. Open the item comparison and review the individual values.

Click the **Evidence** column to group matching tags, again to reverse the group order, and a third time to return to job order. The title search matches existing and proposed titles. Reset the view to clear its filter and query.

## Stop, continue and undo

Use **Stop** while a job runs. The current save or metadata write is allowed to finish safely. Use the action described by the stop message to continue the remaining work. Finding, applying and undoing have different continuation scopes.

Open the advanced job tools to reload the latest saved job. Results with retained reading evidence are revalidated with the current policies. Older results without that evidence retain their saved judgement.

Use **Undo changes** to restore selected applied items. When no applied items are selected, it restores all applied items in that job. Items manually edited in Zotero after application are skipped to protect those later edits. Keep saved job records when you need the plugin's retained history and backups.

## Mark and export items for later

Flag items you want to revisit and export the flagged items from the job tools. The report can contain titles, sources, extracted text, item keys and file information. Review it before sharing. A flag does not approve a field or authorize application.

## Interface language and storage

The interface follows Zotero's application language. Korean uses Korean; every other language uses English. Reopen the plugin after changing Zotero's language. Bibliographic values, titles, source text and model names remain in their original form.

Jobs, recognition caches, OCR records and undo history are stored beneath Zotero's data directory. See [Privacy](PRIVACY.md) for service requests and storage details, and [Security](../SECURITY.md) for reporting problems safely.

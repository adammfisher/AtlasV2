# Routing run — gates PASS

| small | 98.4% | 100.0% | 100.0% | 1.3% | 1.3% |
| mid | 99.3% | 100.0% | 100.0% | 0.7% | 3.0% |
| frontier | 99.7% | 100.0% | 100.0% | 0.0% | 2.6% |

## small  overall 98.4% · edit-vs-describe 100.0% · unambiguous 100.0% · esc 1.3% · clarify 1.3%  [gates PASS]
- [ambiguous] exp clarify-before-acting → got read-summarize-file :: help me with this file
- [ambiguous] exp clarify-before-acting → got edit-md :: deal with the deck
- [ambiguous] exp clarify-before-acting → got followup-anaphora :: this needs work
- [ambiguous] exp clarify-before-acting → got read-summarize-file :: take care of this file
- [ambiguous] exp clarify-before-acting → got data-analysis-on-file :: do the thing with the spreadsheet

## mid  overall 99.3% · edit-vs-describe 100.0% · unambiguous 100.0% · esc 0.7% · clarify 3.0%  [gates PASS]
- [ambiguous] exp clarify-before-acting → got read-summarize-file :: take care of this file
- [adversarial] exp plain-conversation-qa → got clarify-before-acting :: is a deck a good format for this?

## frontier  overall 99.7% · edit-vs-describe 100.0% · unambiguous 100.0% · esc 0.0% · clarify 2.6%  [gates PASS]
- [ambiguous] exp clarify-before-acting → got read-summarize-file :: help me with this file


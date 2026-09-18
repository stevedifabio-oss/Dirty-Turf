# Community Post UX Audit

Reference reviewed: the live Dirty Turf GoHighLevel community feed on September 18, 2026.

## Required parity

| Area | Reference behavior | App implementation | Status |
| --- | --- | --- | --- |
| Feed identity | Avatar, author, age, `posted in`, channel tag, options menu | Matching hierarchy with a clickable channel tag and functional post menu | Complete |
| Post copy | Paragraphs and lists retain formatting | Plain-text parser renders paragraphs, unordered lists, and ordered lists | Complete |
| Long posts | Copy expands in place with `View More` | Long or structurally dense posts expand and collapse in the feed | Complete |
| Media | Attachments appear between copy and engagement | Imported images, videos, and links render in a responsive gallery | Complete |
| Engagement | Like and comment counts sit above equal Like, Comment, Share actions | Matching summary and three-action row with persistent state | Complete |
| Comments | Compact comment composer is always visible | Every feed card has a persistent composer with mentions and a real submit state | Complete |
| Thread view | A post can be revisited with its comments and reply controls | Dedicated responsive thread with nested replies, reactions, mentions, and deep links | Complete |
| Saving and sharing | Post actions expose member utilities | Save/unsave and clean copy-link actions are functional; native share is used when available | Complete |
| Mobile | Controls remain usable without horizontal page overflow | Verified at 390x844 and 320x700 | Complete |
| Accessibility | Actions have clear labels and focus targets | Semantic buttons, menu roles, expanded state, labels, and keyboard focus targets | Complete |

## Intentional differences

- The app opens a dedicated thread view from the post title. This supports notification deep links and gives mobile comments more room while preserving in-feed expansion for long copy.
- Bookmarking lives in the options menu so the primary action row remains the same three actions members already know.
- Unsupported attachment controls are not shown as decorative buttons. Existing imported media works; author uploads should only appear once the private-storage upload flow is connected end to end.

## Verification

- Component type-check and focused post-formatting tests pass.
- Desktop and phone layouts were visually reviewed against the live reference.
- Comment focus/draft behavior, thread navigation, post menus, and browser console state were exercised in the local app.

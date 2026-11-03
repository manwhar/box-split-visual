# Explorable starter

Everything you need to turn one research paper into an explorable: slides
you can play with, built with an AI agent.

## 1. Unzip the starter

Unzip the download and keep the `explorable-starter` folder wherever you
keep your work.

## 2. Add your paper

Put the paper's PDF in `explorables/rename-to-your-paper/`, and anything else
that helps, such as a link to its code or your notes, in that folder's
`notes/` folder.

## 3. Start a project in your AI app

If you’re eligible, claim a student offer before opening the app (optional):

- **Codex:** Open the [ChatGPT student offer](https://chatgpt.com/students/2026/),
  sign in to the account you’ll use for Codex, and choose **Claim free offer**.
  Verify through SheerID with your school email and finish activating the offer.
  Eligible U.S. college students get four months of ChatGPT Plus free if claimed
  by October 31, 2026. New subscriptions require a payment method and renew at
  $20/month afterward unless cancelled.
- **Antigravity:** Open the [Gemini student offer](https://gemini.google/us/students/?hl=en)
  with a personal Google account and choose **Claim Free Student Plan**. Verify
  through SheerID and finish activating the subscription. Eligible U.S. college
  students aged 18+ get one year of Google AI Pro free if claimed by December 31,
  2026. A payment method is required; it renews at $19.99/month afterward unless
  cancelled. School-managed accounts are [not eligible](https://one.google.com/offer/studentoffer8?g1_landing_page=0).

Open this folder as a new project in Codex (in the ChatGPT app), Claude Code
(the Code tab of the Claude app), Antigravity or OpenCode. If you claimed a
student offer, sign in to the app with that same account. Each finds the
`create-paper-explorable` skill here.

Choose a model and its reasoning or thinking setting:

| App | Recommended model and setting |
| --- | --- |
| [Codex](https://learn.chatgpt.com/docs/models) | In **Power > Advanced**, choose **GPT-6 Astra**, **High**. **GPT-6.1 Sol**, **High** uses less of your allowance. |
| [Claude Code](https://code.claude.com/docs/en/model-config#adjust-effort-level) | Choose **Claude Opus 5.5** and **High** in the model and effort menus. |
| [Antigravity](https://www.antigravity.google/docs/models/) | Choose **Gemini 4 Argon**, **High**. If Argon isn’t available in your account, choose **Gemini 3.8 Flash**, **High**. |
| [OpenCode](https://opencode.ai/docs/models/) | Choose **DeepSeek V4.1 Flash Free**, our recommended free model for creating an explorable. OpenCode offers it [free for a limited time](https://opencode.ai/v2/docs/console/models/#free-models); select the version labeled **Free**. |

High is our starting recommendation for recreating and checking a paper.
Extra high, where available, can help with difficult replication or debugging,
but takes longer and uses more of your allowance. For quick edits, a lower
setting is usually enough.

In Codex, when **Review hooks** appears, click it, select the two **Save authoring
transcript** hooks, and choose **Allow selected**.

Your agent also saves your authoring conversation to `transcripts/` inside
the paper's folder on each turn. These transcripts accompany your submission
so we can give feedback on your process and improve the agent skill. They
are not published with your presentation. Each chat has its own JSONL file;
continuing a chat updates that file without duplicating messages.

Your agent handles transcript setup, checks that saving is working, and helps
resolve any problem before packaging. It will ask if your app needs an action
from you.

Begin chatting with the agent to create your explorable. Start with the
suggested prompt in step 4 below.

## 4. Start with this prompt

Paste this into your app’s chat and send it to begin:

> Use the /create-paper-explorable skill to help me build an explorable of the
> paper in explorables/rename-to-your-paper. Its PDF is in that folder, and my
> other context is in its notes folder. Start by getting the paper's full
> system running and checking it against the paper. Then help me understand
> it and break it into small interactive examples that we can try and refine,
> one mechanism at a time. See the other examples in the project.

The agent will suggest a name for `explorables/rename-to-your-paper/` based
on your paper, in lowercase words joined by hyphens such as
`schelling-segregation`, and rename it once you agree.

## 5. Preview it

```bash
python3 explorables/serve.py
```

Then open http://localhost:8790/explorables/. The gallery lists your
explorable and anything that doesn't yet follow the format.
`explorables/CONTRIBUTING.md` describes the format in full.

## 6. Package it to submit

Send this message to your agent:

> Use the /package-explorable skill to prepare my explorable for submission.

The agent checks your explorable and creates `your-paper.zip` in **the top
level of your unzipped starter folder**, beside this `README.md`. The ZIP is
named after your paper's folder, and the agent will give you a link to it.

It includes your presentation and your saved conversations, leaving out PDFs,
hidden files, and the `lab` and `notes` folders. Upload that ZIP with the
submission form.

# agent-kit

Skills for the Hermes agents (Finn, Frida, Kasper). To install or refresh them on the host,
run as `stig` (not root) from a fresh clone of this repo:

    agent-kit/install-skills.sh --dry-run   # show what would change
    agent-kit/install-skills.sh             # install into /srv/agents/<agent>/skills

It fetches the pinned upstream skills, verifies the commit SHAs, and replaces only the
managed skill folders (plus `KIT-SOURCE.txt`); `handbook/` and other folders are left alone.
Use `--root DIR` to target a different agents root. Lars is not covered (his skills go through the Paperclip API).

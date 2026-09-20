#!/usr/bin/env python3
"""Control the bot's Koyeb hosting from the command line: logs, redeploy, settings.

Your Koyeb API key is read from the environment variable KOYEB_API_KEY, or from the file
~/.koyeb.env (a line reading KOYEB_API_KEY=...). It is never printed, and never passed on the
command line. To store it, run this in your own terminal:

    python tools/koyeb.py setup

Commands (SERVICE may be left out while you only have one service):

    setup                            store your API key (asks for it, nothing is echoed)
    keyfile                          same thing, but paste into a file - use this if paste is blocked
    whoami                           check the key works, show the organization
    apps                             your Koyeb apps
    ls                               your services: status, instance, region
    info    [SERVICE]                one service in detail, including its settings
    logs    [SERVICE] [LINES]        recent runtime logs          (--build for build logs)
    deploy  [SERVICE]                redeploy it now              (--skip-build to reuse the last build)
    env     [SERVICE]                its settings (values hidden)
    set     [SERVICE] KEY=VALUE ...  change settings, then redeploy  (KEY=@name binds a Koyeb secret)
    unset   [SERVICE] KEY ...        remove settings, then redeploy
    pause   [SERVICE]                stop it (a free instance keeps its settings)
    resume  [SERVICE]                start it again
    deployments [SERVICE]            the last few deployments and how they went
    secrets                          the names of your Koyeb secrets (values are never shown)

Passwords, tokens and API keys are not typed here: `set` refuses a plain secret value and tells
you how to store it as a Koyeb secret instead, which this tool can then bind by name.
"""
import json
import os
import re
import sys
import calendar
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://app.koyeb.com/v1"
ENV_FILE = Path.home() / ".koyeb.env"

# How this tool refers to itself in what it prints: short while you are standing in the repository,
# the full path from anywhere else, so every example can be pasted exactly as it appears.
HERE = Path(__file__).resolve()
try:
    ME = str(HERE.relative_to(Path.cwd()))
except ValueError:
    ME = str(HERE)
RUN = "python " + ME

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# ---- the key -------------------------------------------------------------------------------------
def api_key():
    key = os.environ.get("KOYEB_API_KEY", "").strip()
    if not key and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "KOYEB_API_KEY":
                key = value.strip().strip("\"'")
    if not key:
        sys.exit(
            "No Koyeb API key yet.\n"
            "  Create one at https://app.koyeb.com/user/settings/api  (Create API credential)\n"
            "  then run:  %s setup     (or %s keyfile if your terminal blocks pasting)" % (RUN, RUN)
        )
    return key


def cmd_setup():
    """Ask for the key and store it. Nothing is echoed and nothing is printed back."""
    import getpass

    if not sys.stdin.isatty():
        sys.exit("Run this in your own terminal - it asks for the key without showing it.")
    print("Create a key at https://app.koyeb.com/user/settings/api  (Create API credential)")
    print("If your terminal will not let you paste here, press Enter and run:  %s keyfile" % RUN)
    key = getpass.getpass("Paste your Koyeb API key (it stays hidden): ").strip()
    if not key:
        sys.exit("Nothing entered. To paste into a file instead, run:  %s keyfile" % RUN)
    if len(key) < 20:
        sys.exit("That does not look like a Koyeb API key - nothing was saved.")
    lines = []
    if ENV_FILE.exists():
        lines = [l for l in ENV_FILE.read_text(encoding="utf-8").splitlines() if not l.startswith("KOYEB_API_KEY")]
    lines.append("KOYEB_API_KEY=" + key)
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(ENV_FILE, 0o600)
    except Exception:
        pass
    print("Saved to %s - it is never printed by this tool." % ENV_FILE)
    print("Checking it with Koyeb...")
    problem = verify()
    if problem:
        print(problem)
        sys.exit(1)
    print("It works.  Try:  %s ls" % RUN)


def verify():
    """Ask Koyeb whether the stored key works. Returns None when it does, else what is wrong."""
    reply = request("GET", "/services", params={"limit": "1"}, soft=True, quiet401=True)
    if reply is not None:
        return None
    return (
        "Koyeb rejected that key.\n"
        "  A Koyeb API key is one long line containing dots. If yours arrived shorter than what you\n"
        "  copied, the terminal dropped part of the paste - that is common on Windows.\n"
        "  Paste it into a file instead, where nothing can be dropped:  %s keyfile" % RUN
    )


def cmd_keyfile():
    """Open the key file in an editor with the line ready, so the key can be pasted normally.

    Some terminals will not paste into a hidden prompt, and typing the key in plain sight would
    leave it in the scrollback. A file avoids both.
    """
    lines = []
    if ENV_FILE.exists():
        lines = [l for l in ENV_FILE.read_text(encoding="utf-8").splitlines()
                 if l.strip() and not l.startswith("KOYEB_API_KEY")]
    if not any(l.startswith("#") for l in lines):
        lines.insert(0, "# Your Koyeb API key. Paste it straight after the = below, then save and close.")
        lines.insert(1, "# Get one at https://app.koyeb.com/user/settings/api  (Create API credential)")
    lines.append("KOYEB_API_KEY=")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        os.chmod(ENV_FILE, 0o600)
    except Exception:
        pass

    print("Opening %s" % ENV_FILE)
    print("  Paste your key right after  KOYEB_API_KEY=  then save and close the editor.")
    opened = False
    try:
        if sys.platform == "win32":
            os.startfile(str(ENV_FILE))          # noqa: S606 - the user's own editor, their own file
            opened = True
        else:
            import subprocess
            subprocess.Popen([os.environ.get("EDITOR", "nano"), str(ENV_FILE)])
            opened = True
    except Exception:
        pass
    if not opened:
        print("  Could not open an editor - open that file yourself.")
    print("\nWhen it is saved, check it with:  %s whoami" % RUN)


# ---- talking to Koyeb ----------------------------------------------------------------------------
def request(method, path, body=None, params=None, soft=False, quiet401=False):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + api_key())
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8", "replace")
        return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:400]
        try:
            detail = json.loads(detail).get("message", detail)
        except Exception:
            pass
        if err.code == 401:
            if quiet401:
                return None
            sys.exit(
                "Koyeb rejected the API key (401): %s\n"
                "  Store it again - and if pasting into the hidden prompt keeps failing, use a file:\n"
                "    %s keyfile" % (mask(str(detail)), RUN)
            )
        if soft:
            return None
        sys.exit("Koyeb said HTTP %s: %s" % (err.code, mask(detail)))
    except urllib.error.URLError as err:
        if soft:
            return None
        sys.exit("Could not reach Koyeb: %s" % err.reason)


# ---- keeping secrets out of the output -------------------------------------------------------------
# Names that always hold something private.
SECRET_HINTS = re.compile(
    r"token|secret|password|passwd|\bpwd\b|key|credential|auth|private|session|cookie|salt|signature"
    r"|webhook|dsn|connection|conn[_-]?str|database[_-]?url|licen[cs]e",
    re.I,
)

# A value can be a credential whatever the setting is called.
CREDENTIAL_SHAPED = [
    re.compile(r"[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@"),        # scheme://user:password@host
    re.compile(r"\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{16,}\b"),   # jwt / bot token
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+/_=-]{24,}$"),   # one long random-looking blob
]


def looks_private(value):
    value = (value or "").strip()
    if not value:
        return False
    return any(pattern.search(value) for pattern in CREDENTIAL_SHAPED)


MASKS = [
    (re.compile(r"([a-z][a-z0-9+.-]*://[^/\s:@]+:)[^/\s@]+(@)"), r"\1***\2"),   # password inside a url
    (re.compile(r"\b([A-Za-z0-9_-]{20,28}\.[A-Za-z0-9_-]{6,8}\.[A-Za-z0-9_-]{25,40})\b"), "***"),          # discord bot token
    (re.compile(r"(https?://(?:discord(?:app)?\.com|ptb\.discord\.com)/api/webhooks/)\S+", re.I), r"\1***"),
    (re.compile(r"((?:authorization|bearer|token|secret|password|api[_-]?key|sync[_-]?key)\W{0,3})([^\s\"',]{8,})", re.I), r"\1***"),
    (re.compile(r"\b(koyeb_[A-Za-z0-9_-]{10,})\b"), "***"),
]


ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def mask(text):
    text = ANSI.sub("", text)
    for pattern, repl in MASKS:
        text = pattern.sub(repl, text)
    return text


def hide(key, value, secret_ref):
    """What to show for one setting. When in doubt, hide it: this output gets pasted around."""
    if secret_ref:
        return "-> Koyeb secret %s" % secret_ref
    if SECRET_HINTS.search(key or "") or looks_private(value):
        return "(hidden, %d characters)" % len(value or "")
    return mask(value or "")


# ---- finding things ------------------------------------------------------------------------------
def services():
    return request("GET", "/services", params={"limit": "100"}).get("services", [])


def pick(name=None):
    found = services()
    alive = [s for s in found if s.get("status") not in ("DELETED", "DELETING")]
    if name:
        match = [s for s in alive if s.get("name") == name or s.get("id") == name]
        if not match:
            sys.exit("No service called %r. Your services: %s" % (name, ", ".join(s["name"] for s in alive) or "none"))
        return match[0]
    if not alive:
        sys.exit("You have no services on Koyeb yet. Create one from the bot's repository first.")
    if len(alive) > 1:
        sys.exit("You have several services - name one: %s" % ", ".join(s["name"] for s in alive))
    return alive[0]


def split_service(args):
    """An optional service name in front of the other arguments, recognised by actually existing."""
    args = list(args)
    if args and "=" not in args[0]:
        alive = [s for s in services() if s.get("status") not in ("DELETED", "DELETING")]
        if any(s.get("name") == args[0] or s.get("id") == args[0] for s in alive):
            return args[0], args[1:]
    return None, args


def latest_deployment(service_id):
    got = request("GET", "/deployments", params={"service_id": service_id, "limit": "1"}).get("deployments", [])
    return got[0] if got else None


def app_names():
    return {a["id"]: a.get("name", "?") for a in request("GET", "/apps", params={"limit": "100"}).get("apps", [])}


def when(stamp):
    if not stamp:
        return "-"
    try:
        made = calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return stamp[:19]
    seconds = max(0, int(time.time() - made))
    for limit, unit, size in ((60, "s", 1), (3600, "m", 60), (86400, "h", 3600)):
        if seconds < limit:
            return "%d%s ago" % (seconds // size, unit)
    return "%dd ago" % (seconds // 86400)


def definition_of(service):
    deployment = latest_deployment(service["id"])
    if not deployment or not deployment.get("definition"):
        sys.exit("That service has no deployment yet, so there is nothing to change.")
    return deployment["definition"], deployment


# ---- commands ------------------------------------------------------------------------------------
def cmd_whoami():
    problem = verify()
    if problem:
        sys.exit(problem)
    profile = request("GET", "/account/profile", soft=True) or {}
    me = profile.get("user") or {}
    if me.get("email") or me.get("name"):
        print("signed in as %s" % (me.get("email") or me.get("name")))
    org = (request("GET", "/account/organization", soft=True) or {}).get("organization") or {}
    if org:
        print("organization %s (plan %s)" % (org.get("name"), org.get("plan", "?")))
    found = services()                                  # this one must work, so no soft
    print("the key works: %d app(s), %d service(s)" % (
        len([a for a in request("GET", "/apps", params={"limit": "100"}).get("apps", []) if a.get("status") != "DELETED"]),
        len([s for s in found if s.get("status") not in ("DELETED", "DELETING")])))


def cmd_apps():
    for app in request("GET", "/apps", params={"limit": "100"}).get("apps", []):
        if app.get("status") == "DELETED":
            continue
        print("%-28s %-10s %s" % (app.get("name"), app.get("status"), app.get("domains", [{}])[0].get("name", "")))


def cmd_ls():
    names = app_names()
    print("%-22s %-14s %-12s %s" % ("SERVICE", "STATUS", "APP", "LAST DEPLOY"))
    for service in services():
        if service.get("status") in ("DELETED", "DELETING"):
            continue
        deployment = latest_deployment(service["id"])
        print("%-22s %-14s %-12s %s" % (
            service.get("name"), service.get("status"), names.get(service.get("app_id"), "?"),
            "%s %s" % ((deployment or {}).get("status", "-"), when((deployment or {}).get("created_at"))),
        ))


def cmd_info(name=None):
    service = pick(name)
    definition, deployment = definition_of(service)
    names = app_names()
    print("service     %s" % service.get("name"))
    print("app         %s" % names.get(service.get("app_id"), "?"))
    print("status      %s" % service.get("status"))
    for message in service.get("messages", []) or []:
        print("            %s" % mask(str(message)))
    print("deployment  %s, %s" % (deployment.get("status"), when(deployment.get("created_at"))))
    for message in (deployment.get("messages") or [])[:3]:
        print("            %s" % mask(str(message)))

    git = definition.get("git") or {}
    if git:
        print("source      %s branch %s%s" % (git.get("repository", "?"), git.get("branch", "?"),
                                              ", work dir " + git["workdir"] if git.get("workdir") else ""))
        builder = "buildpack" if git.get("buildpack") is not None else ("dockerfile" if git.get("docker") else "?")
        print("builder     %s" % builder)
    if definition.get("docker"):
        print("image       %s" % definition["docker"].get("image"))

    print("regions     %s" % ", ".join(definition.get("regions") or []))
    for scaling in definition.get("scalings") or []:
        print("instances   %s min, %s max" % (scaling.get("min"), scaling.get("max")))
    for instance in definition.get("instance_types") or []:
        print("size        %s" % instance.get("type"))
    for port in definition.get("ports") or []:
        print("port        %s (%s)" % (port.get("port"), port.get("protocol")))
    for check in definition.get("health_checks") or []:
        http = check.get("http") or {}
        print("health      %s %s" % (http.get("path", "-"), "every %ss" % check.get("interval") if check.get("interval") else ""))

    for app in request("GET", "/apps", params={"limit": "100"}).get("apps", []):
        if app.get("id") == service.get("app_id"):
            for domain in app.get("domains", []) or []:
                print("address     https://%s" % domain.get("name"))

    print("settings")
    for item in definition.get("env") or []:
        print("   %-24s %s" % (item.get("key"), hide(item.get("key"), item.get("value"), item.get("secret"))))


def cmd_env(name=None):
    service = pick(name)
    definition, _ = definition_of(service)
    for item in definition.get("env") or []:
        print("%-24s %s" % (item.get("key"), hide(item.get("key"), item.get("value"), item.get("secret"))))


def cmd_logs(*args):
    args = list(args)
    kind = "build" if "--build" in args else "runtime"
    args = [a for a in args if a != "--build"]
    lines = 60
    name = None
    for arg in args:
        if arg.isdigit():
            lines = min(int(arg), 500)
        else:
            name = arg
    service = pick(name)
    params = {"type": kind, "limit": str(lines), "order": "desc"}
    if kind == "build":
        # The build happens per deployment, so these logs are only addressable that way.
        deployment = latest_deployment(service["id"])
        if not deployment:
            sys.exit("%s has not been deployed yet, so there is no build log." % service.get("name"))
        params["deployment_id"] = deployment["id"]
        print("build log of the deployment from %s (%s)" % (when(deployment.get("created_at")), deployment.get("status")))
    else:
        params["service_id"] = service["id"]
    reply = request("GET", "/streams/logs/query", params=params)
    entries = list(reversed(reply.get("data") or []))
    if not entries:
        print("No %s logs for %s." % (kind, service.get("name")))
        return
    for entry in entries:
        stamp = (entry.get("created_at") or "")[11:19]
        print("%s  %s" % (stamp, mask((entry.get("msg") or "").rstrip())))


def cmd_deployments(name=None):
    service = pick(name)
    got = request("GET", "/deployments", params={"service_id": service["id"], "limit": "10"}).get("deployments", [])
    for deployment in got:
        print("%-12s %-10s %s" % (deployment.get("status"), when(deployment.get("created_at")), deployment.get("id", "")[:8]))
        for message in (deployment.get("messages") or [])[:2]:
            print("     %s" % mask(str(message)))


def cmd_deploy(*args):
    args = list(args)
    skip_build = "--skip-build" in args
    name = next((a for a in args if not a.startswith("--")), None)
    service = pick(name)
    request("POST", "/services/%s/redeploy" % service["id"], body={"skip_build": skip_build, "use_cache": not skip_build})
    print("redeploying %s%s - watch it with:  %s logs --build" % (
        service.get("name"), " (reusing the last build)" if skip_build else "", RUN))


def apply_definition(service, definition, what):
    request("PATCH", "/services/%s" % service["id"], body={"definition": definition})
    print("%s on %s - a new deployment has started." % (what, service.get("name")))


def cmd_set(*args):
    name, args = split_service(args)
    pairs = [a for a in args if "=" in a]
    if not pairs:
        sys.exit("Nothing to set. Example:  %s set FIVEM_URL=http://23.27.211.21:30136" % RUN)

    service = pick(name)
    definition, _ = definition_of(service)
    env = list(definition.get("env") or [])
    scopes = next((e.get("scopes") for e in env if e.get("scopes")), ["public"])

    for pair in pairs:
        key, _, value = pair.partition("=")
        key = key.strip()
        value = value.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            sys.exit("%r is not a valid setting name." % key)

        if value.startswith("@"):
            entry = {"scopes": scopes, "key": key, "secret": value[1:]}
        else:
            if SECRET_HINTS.search(key):
                sys.exit(
                    "%s holds a secret, so it is not typed here.\n"
                    "  1. https://app.koyeb.com/secrets -> Create secret, name it for example %s, paste the value there\n"
                    "  2. then run:  %s set %s=@%s" % (key, key.lower(), RUN, key, key.lower())
                )
            entry = {"scopes": scopes, "key": key, "value": value}

        for index, existing in enumerate(env):
            if existing.get("key") == key:
                env[index] = entry
                break
        else:
            env.append(entry)
        print("   %-24s %s" % (key, hide(key, entry.get("value"), entry.get("secret"))))

    definition["env"] = env
    apply_definition(service, definition, "settings changed")


def cmd_unset(*args):
    name, args = split_service(args)
    service = pick(name)
    if not args:
        sys.exit("Name at least one setting to remove.")
    definition, _ = definition_of(service)
    before = definition.get("env") or []
    after = [e for e in before if e.get("key") not in args]
    if len(after) == len(before):
        sys.exit("None of those settings exist on %s." % service.get("name"))
    definition["env"] = after
    apply_definition(service, definition, "removed %s" % ", ".join(args))


def cmd_pause(name=None):
    service = pick(name)
    request("POST", "/services/%s/pause" % service["id"])
    print("%s paused." % service.get("name"))


def cmd_resume(name=None):
    service = pick(name)
    request("POST", "/services/%s/resume" % service["id"])
    print("%s starting again." % service.get("name"))


def cmd_secrets():
    got = request("GET", "/secrets", params={"limit": "100"}).get("secrets", [])
    if not got:
        print("No Koyeb secrets yet. Create them at https://app.koyeb.com/secrets")
    for secret in got:
        print("%-28s %s" % (secret.get("name"), when(secret.get("updated_at"))))
    print("\nBind one to a setting with:  %s set KEY=@secretname" % RUN)


COMMANDS = {
    "setup": cmd_setup, "keyfile": cmd_keyfile, "whoami": cmd_whoami, "apps": cmd_apps, "ls": cmd_ls, "info": cmd_info,
    "logs": cmd_logs, "deploy": cmd_deploy, "env": cmd_env, "set": cmd_set, "unset": cmd_unset,
    "pause": cmd_pause, "resume": cmd_resume, "deployments": cmd_deployments, "secrets": cmd_secrets,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](*sys.argv[2:])

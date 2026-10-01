"""Install the dedicated Bedrock credential on the verified Posnic Lightsail host.

No secret is written locally, printed, or passed in process arguments. Existing
application environments are not changed and no process is restarted.
"""
import argparse
import hashlib
import json
import pathlib
import shlex
import subprocess

ACCOUNT = "719443252592"
USER = "posnic-ask-bedrock"
HOST = "ubuntu@13.207.75.191"
REMOTE_PROFILE = "posnic-ask-bedrock"
POLICY = pathlib.Path(__file__).resolve().parents[1] / "infra/ask-posnic-bedrock-policy.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="posnic-admin")
    parser.add_argument("--ssh-key", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    def aws(*command, missing_ok=False):
        result = subprocess.run(["aws", *command, "--profile", args.profile, "--output", "json"], capture_output=True, text=True)
        if result.returncode:
            if missing_ok and "NoSuchEntity" in result.stderr:
                return None
            raise RuntimeError("AWS operation failed: " + " ".join(command[:2]))
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def remote(code, payload=None):
        result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-i", args.ssh_key, HOST,
                                 "python3 -c " + shlex.quote(code)], input=json.dumps(payload) if payload else None, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Remote credential installation/check failed; no secret output retained.")
        return result.stdout.strip()

    if aws("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("Wrong AWS account; refusing provisioning.")
    instance = aws("lightsail", "get-instance", "--instance-name", "posnic-core-8gb", "--region", "ap-south-1")["instance"]
    if instance["publicIpAddress"] != HOST.split("@")[1] or instance["state"]["name"] != "running":
        raise RuntimeError("The expected Lightsail host is not running at the policy's allowed IP.")
    policy = json.loads(POLICY.read_text())
    digest = hashlib.sha256(POLICY.read_bytes()).hexdigest()
    print(json.dumps({"account": ACCOUNT, "user": USER, "host": HOST, "policy_sha256": digest, "apply": args.apply}))
    if not args.apply:
        return
    existing_profile = remote("import configparser,os; p=configparser.RawConfigParser(); p.read(os.path.expanduser('~/.aws/credentials')); print(p.has_section('posnic-ask-bedrock'))")
    if existing_profile == "True":
        raise RuntimeError("Dedicated profile already exists. Verify it; do not create a duplicate key.")
    existing_user = aws("iam", "get-user", "--user-name", USER, missing_ok=True)
    if existing_user:
        tags = {tag["Key"]: tag["Value"] for tag in existing_user["User"].get("Tags", [])}
        if tags.get("Application") != "PosnicAsk":
            raise RuntimeError("Existing IAM user is not marked for this application.")
        if aws("iam", "list-access-keys", "--user-name", USER).get("AccessKeyMetadata"):
            raise RuntimeError("Existing keys need review before provisioning another credential.")
    else:
        aws("iam", "create-user", "--user-name", USER, "--tags", "Key=Application,Value=PosnicAsk", "Key=Host,Value=posnic-core-8gb")
    aws("iam", "put-user-policy", "--user-name", USER, "--policy-name", "InvokeSelectedPosnicModel", "--policy-document", "file://" + POLICY.as_posix())
    credential = aws("iam", "create-access-key", "--user-name", USER)["AccessKey"]
    install = """
import configparser,json,os,pathlib,sys
value=json.load(sys.stdin)
directory=pathlib.Path.home()/'.aws'
directory.mkdir(mode=0o700,exist_ok=True)
file=directory/'credentials'
parser=configparser.RawConfigParser()
parser.read(file)
if parser.has_section('posnic-ask-bedrock'): raise RuntimeError('Profile already exists')
fd=os.open(file,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
with os.fdopen(fd,'a') as f:
    f.write('\\n[posnic-ask-bedrock]\\naws_access_key_id = '+value['AccessKeyId']+'\\naws_secret_access_key = '+value['SecretAccessKey']+'\\n')
    f.flush()
    os.fsync(f.fileno())
os.chmod(file,0o600)
print('Dedicated profile installed with file mode 0600; no app settings changed.')
"""
    try:
        print(remote(install, credential))
    except Exception:
        aws("iam", "delete-access-key", "--user-name", USER, "--access-key-id", credential["AccessKeyId"])
        raise
    finally:
        credential.clear()
    print(json.dumps({"result": "installed", "profile": REMOTE_PROFILE, "iam_user_arn": f"arn:aws:iam::{ACCOUNT}:user/{USER}"}))


if __name__ == "__main__":
    main()

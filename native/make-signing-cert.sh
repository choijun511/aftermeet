#!/usr/bin/env bash
# 一次性:创建并信任一张自签名「代码签名」证书 "AfterMeet Local Signing"。
#
# 为什么需要:ad-hoc 签名(codesign -s -)没有稳定身份(TeamIdentifier=not set,
# 每次重新打包 cdhash 都变),macOS TCC 的「屏幕录制」授权无法牢固绑定,会反复弹窗。
# 用一张固定的自签名证书签名后,TCC 把授权绑定到证书身份,授权一次永久生效、跨重新打包不失效。
#
# 运行后,electron-builder.yml 里 mac.identity 已设为 "AfterMeet Local Signing",
# `npm run dist:mac` 会用它做正确的「由内而外」签名(不要再用 codesign --deep 手动签,
# 那样会在 Electron Framework 上报 errSecInternalComponent)。
#
# 如果换机器 / 钥匙串被清空,重跑本脚本即可。
set -e
NAME="AfterMeet Local Signing"

if security find-identity -p codesigning -v | grep -q "$NAME"; then
  echo "[cert] 已存在有效身份「$NAME」,无需重建"
  exit 0
fi

WORK="$(mktemp -d)"; cd "$WORK"
cat > cfg <<'EOF'
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=AfterMeet Local Signing
[v3]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF
echo "[cert] 生成自签名证书…"
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -config cfg >/dev/null 2>&1
openssl pkcs12 -export -inkey key.pem -in cert.pem -out id.p12 -passout pass:aftermeet -name "$NAME" >/dev/null 2>&1

echo "[cert] 导入登录钥匙串(-A 允许 codesign 免提示访问私钥)…"
security import id.p12 -k ~/Library/Keychains/login.keychain-db -P aftermeet -T /usr/bin/codesign -A

echo "[cert] 添加 codeSign 信任(可能弹一次钥匙串授权,点允许/输密码)…"
security add-trusted-cert -r trustRoot -p codeSign cert.pem || true

if security find-identity -p codesigning -v | grep -q "$NAME"; then
  echo "[cert] 完成,身份「$NAME」可用"
else
  echo "[cert] !! 未成为有效身份,请检查钥匙串信任设置"
  exit 1
fi
rm -rf "$WORK"

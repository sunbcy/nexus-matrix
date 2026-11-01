#!/usr/bin/env python3
"""生成强随机的 NEXUS_API_KEY 密钥（密码学安全，跨平台）。

用法：
    python tools/gen_api_key.py            # 生成一个默认 32 字节的 URL 安全密钥
    python tools/gen_api_key.py --count 3  # 生成 3 个（多用户 / 多设备各一个）
    python tools/gen_api_key.py --bytes 48 # 更长的密钥

输出即密钥本身，直接用于：
  - 环境变量 NEXUS_API_KEY（多个用逗号分隔）
  - 或手动写入 keys.json 的场景

注意：从 backend/ 目录运行时用  python ../tools/gen_api_key.py
"""
import argparse
import secrets
import sys


def main() -> int:
    p = argparse.ArgumentParser(description="生成强随机的 NEXUS_API_KEY 密钥")
    p.add_argument("-n", "--count", type=int, default=1, help="生成几个密钥（默认 1）")
    p.add_argument("-b", "--bytes", type=int, default=32, help="每个密钥的随机字节数（默认 32）")
    args = p.parse_args()

    if args.count < 1:
        p.error("--count 必须 >= 1")
    if args.bytes < 16:
        p.error("--bytes 太小，至少 16 才够安全")

    keys = [secrets.token_urlsafe(args.bytes) for _ in range(args.count)]
    for k in keys:
        print(k)

    if args.count == 1:
        print("\n↑ 复制这一行填进 NEXUS_API_KEY（环境变量）；并在 Web / Android 的「访问密钥」里填同一个值。",
              file=sys.stderr)
    else:
        print(f"\n↑ 共 {args.count} 个密钥，逗号分隔填进 NEXUS_API_KEY，或分别发给不同用户。",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

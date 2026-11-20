#!/bin/zsh
# Usage: heavy-run.sh <owner-label> <command...>
# Runs one heavy command at a time. The lock lives next to this script.
L=${0:A:h}/.locks/heavy
owner=$1; shift
if [[ "$(cut -d' ' -f1 $L/owner 2>/dev/null)" == "$owner" ]] && kill -0 $(cat $L/pid 2>/dev/null) 2>/dev/null; then
  "$@"; exit $?
fi
mkdir -p ${L:h}
until mkdir $L 2>/dev/null; do
  if [[ -f $L/pid ]] && ! kill -0 $(cat $L/pid) 2>/dev/null; then rm -rf $L; continue; fi
  sleep 20
done
echo $$ > $L/pid; echo "$owner $* $(date -u +%FT%TZ)" > $L/owner
trap 'rm -rf $L' EXIT INT TERM
"$@"

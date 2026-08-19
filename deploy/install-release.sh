#!/usr/bin/env bash
set -euo pipefail

release_id="${1:?release id is required}"
release_root="/home/system/releases"
release_dir="${release_root}/${release_id}"
current_link="/home/system/fenbeittong-offline"
data_dir="/home/system/fenbeittong-offline-data"
upload_dir="/home/system/deploy-upload"

case "${release_dir}" in
  /home/system/releases/fenbeittong-offline-*) ;;
  *) echo "invalid release path: ${release_dir}" >&2; exit 1 ;;
esac

if [[ -e "${current_link}" && ! -L "${current_link}" ]]; then
  echo "deployment target exists and is not a symlink: ${current_link}" >&2
  exit 1
fi

mkdir -p "${release_dir}" "${data_dir}"
tar -xzf "${upload_dir}/fenbeittong-offline-latest.tar.gz" -C "${release_dir}"

if [[ ! -f "${data_dir}/state.json" ]]; then
  tar -xzf "${upload_dir}/fenbeittong-offline-data.tar.gz" -C "${data_dir}"
fi

chown -R system:system "${release_dir}" "${data_dir}"
chmod 700 "${data_dir}"
chmod 600 "${release_dir}/.env" "${data_dir}/fenbeitong-tenants.sqlite"
ln -sfn "${release_dir}" "${current_link}"

install -m 0644 "${upload_dir}/fenbeittong-backend.service" /etc/systemd/system/fenbeittong-backend.service
install -m 0644 "${upload_dir}/fenbeittong-frontend.service" /etc/systemd/system/fenbeittong-frontend.service
systemctl daemon-reload
systemctl enable fenbeittong-backend.service fenbeittong-frontend.service
systemctl restart fenbeittong-backend.service fenbeittong-frontend.service

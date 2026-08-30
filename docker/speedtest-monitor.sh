#!/bin/sh
# Mede a velocidade real do link de internet (speedtest-cli) e envia os
# resultados pro Zabbix via zabbix_sender (item trapper) — roda via cron no
# host, não dentro de container. O roteador da Vivo não expõe SNMP, então
# essa é a alternativa: amostragem periódica em vez de contador contínuo.
#
# Pré-requisito: host "Link Vivo" no Zabbix com 3 itens trapper:
#   net.speedtest.download  (Numeric float, unidade bps)
#   net.speedtest.upload    (Numeric float, unidade bps)
#   net.speedtest.ping      (Numeric float, unidade ms)
set -e

ZABBIX_HOST="Link Vivo"
RESULT=$(timeout 90 speedtest-cli --json)

DOWNLOAD=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['download'])")
UPLOAD=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['upload'])")
PING=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['ping'])")

docker exec zabbix-server zabbix_sender -z 127.0.0.1 -p 10051 -s "$ZABBIX_HOST" -k net.speedtest.download -o "$DOWNLOAD"
docker exec zabbix-server zabbix_sender -z 127.0.0.1 -p 10051 -s "$ZABBIX_HOST" -k net.speedtest.upload -o "$UPLOAD"
docker exec zabbix-server zabbix_sender -z 127.0.0.1 -p 10051 -s "$ZABBIX_HOST" -k net.speedtest.ping -o "$PING"

echo "Speedtest enviado: download=$DOWNLOAD upload=$UPLOAD ping=$PING"

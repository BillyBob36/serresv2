#!/bin/bash
# Deploy PJ scraper to 6 Azure VMs
# Usage: bash scripts/deploy-pj-azure.sh

set -e

RESOURCE_GROUP="scraper-rg"
LOCATION="francecentral"
VM_SIZE="Standard_D4s_v5"
VM_COUNT=6
ADMIN_USER="scraper"
ADMIN_PASS="Scraper2026Azure!"
IMAGE="Canonical:ubuntu-24_04-lts:server:latest"

CSV_FILE="data/prospects_pj.csv"
TOTAL_LINES=$(($(wc -l < "$CSV_FILE") - 1))  # minus header
LINES_PER_VM=$(( (TOTAL_LINES + VM_COUNT - 1) / VM_COUNT ))

echo "=== PJ Scraper Azure Deployment ==="
echo "Total prospects: $TOTAL_LINES"
echo "VMs: $VM_COUNT x $VM_SIZE"
echo "Lines per VM: ~$LINES_PER_VM"
echo ""

# Split CSV into chunks (keeping header)
HEADER=$(head -1 "$CSV_FILE")
tail -n +2 "$CSV_FILE" > /tmp/pj_body.csv
split -l $LINES_PER_VM -d --additional-suffix=.csv /tmp/pj_body.csv /tmp/pj_chunk_

# Add header back to each chunk
for chunk in /tmp/pj_chunk_*.csv; do
  echo "$HEADER" | cat - "$chunk" > /tmp/tmp_chunk && mv /tmp/tmp_chunk "$chunk"
  echo "Chunk: $chunk ($(wc -l < "$chunk") lines)"
done

# Create VMs
echo ""
echo "Creating $VM_COUNT VMs..."
VM_IPS=()

for i in $(seq 0 $((VM_COUNT - 1))); do
  VM_NAME="pj-scraper-$i"
  echo "Creating $VM_NAME..."

  IP=$(az vm create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --size "$VM_SIZE" \
    --image "$IMAGE" \
    --admin-username "$ADMIN_USER" \
    --admin-password "$ADMIN_PASS" \
    --authentication-type password \
    --public-ip-sku Standard \
    --nsg-rule SSH \
    --location "$LOCATION" \
    --no-wait \
    --query publicIpAddress -o tsv 2>/dev/null || echo "PENDING")

  VM_IPS+=("$VM_NAME")
done

# Wait for all VMs
echo "Waiting for VMs to be created..."
for i in $(seq 0 $((VM_COUNT - 1))); do
  VM_NAME="pj-scraper-$i"
  echo "Waiting for $VM_NAME..."
  az vm wait --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --created 2>/dev/null
done

# Get IPs
echo ""
echo "Getting IPs..."
declare -A VM_IP_MAP
for i in $(seq 0 $((VM_COUNT - 1))); do
  VM_NAME="pj-scraper-$i"
  IP=$(az vm show --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --show-details --query publicIps -o tsv)
  VM_IP_MAP[$i]="$IP"
  echo "$VM_NAME: $IP"
done

# Setup script for each VM
SETUP_SCRIPT='#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Install Playwright dependencies
npx playwright install-deps chromium 2>/dev/null || apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2 libatspi2.0-0 libwayland-client0

echo "VM setup complete"
'

# Deploy to each VM
echo ""
echo "Setting up VMs and deploying scraper..."
for i in $(seq 0 $((VM_COUNT - 1))); do
  VM_NAME="pj-scraper-$i"
  IP="${VM_IP_MAP[$i]}"
  CHUNK="/tmp/pj_chunk_0${i}.csv"

  if [ -z "$IP" ] || [ "$IP" = "PENDING" ]; then
    echo "Skipping $VM_NAME — no IP"
    continue
  fi

  echo ""
  echo "=== Setting up $VM_NAME ($IP) ==="

  # Wait for SSH
  for attempt in $(seq 1 30); do
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$ADMIN_USER@$IP" "echo ok" 2>/dev/null && break
    echo "  Waiting for SSH ($attempt/30)..."
    sleep 10
  done

  # Run setup
  echo "$SETUP_SCRIPT" | ssh -o StrictHostKeyChecking=no "$ADMIN_USER@$IP" "cat > /tmp/setup.sh && chmod +x /tmp/setup.sh && sudo bash /tmp/setup.sh"

  # Upload scraper code
  echo "  Uploading scraper code..."
  scp -o StrictHostKeyChecking=no tools/pj-scraper/package.json "$ADMIN_USER@$IP:~/package.json"
  scp -o StrictHostKeyChecking=no tools/pj-scraper/tsconfig.json "$ADMIN_USER@$IP:~/tsconfig.json" 2>/dev/null || true
  ssh -o StrictHostKeyChecking=no "$ADMIN_USER@$IP" "mkdir -p ~/src"
  scp -o StrictHostKeyChecking=no tools/pj-scraper/src/*.ts "$ADMIN_USER@$IP:~/src/"

  # Upload CSV chunk
  echo "  Uploading CSV chunk ($CHUNK)..."
  scp -o StrictHostKeyChecking=no "$CHUNK" "$ADMIN_USER@$IP:~/prospects.csv"

  # Install deps and launch
  echo "  Installing deps and launching..."
  ssh -o StrictHostKeyChecking=no "$ADMIN_USER@$IP" "
    cd ~
    npm install 2>&1 | tail -3
    npx playwright install chromium 2>&1 | tail -3
    nohup npx tsx src/index.ts --input prospects.csv --output results.csv > scraper.log 2>&1 &
    echo 'Scraper launched (PID: \$!)'
  "

  echo "  $VM_NAME ready and running!"
done

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Monitor progress:"
for i in $(seq 0 $((VM_COUNT - 1))); do
  IP="${VM_IP_MAP[$i]}"
  echo "  ssh $ADMIN_USER@$IP \"tail -5 ~/scraper.log\""
done
echo ""
echo "Quick check all:"
echo '  for vm in '"$(for i in $(seq 0 $((VM_COUNT - 1))); do echo -n "${VM_IP_MAP[$i]} "; done)"'; do echo "=== $vm ===" && ssh '"$ADMIN_USER"'@$vm "tail -1 ~/scraper.log"; done'

import subprocess
import time

result = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, encoding='gbk', errors='ignore')
killed = 0
for line in result.stdout.strip().split('\n'):
    if 'harness' in line.lower() or 'deepseek' in line.lower():
        parts = line.split('","')
        if len(parts) >= 2:
            pid = parts[1].strip('"')
            subprocess.run(['taskkill', '/PID', pid, '/F'], capture_output=True)
            killed += 1
print(f'Killed {killed} processes')
time.sleep(3)
print('Done')

import subprocess

# 查找Harness进程监听的端口
result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, encoding='gbk', errors='ignore')
lines = result.stdout.strip().split('\n')
harness_pids = set()

# 先找Harness的PID
tasklist = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, encoding='gbk', errors='ignore')
for line in tasklist.stdout.strip().split('\n'):
    if 'harness' in line.lower() or 'deepseek' in line.lower():
        parts = line.split(',')
        if len(parts) >= 2:
            pid = parts[1].strip('"')
            harness_pids.add(pid)
print('Harness PIDs:', harness_pids)

# 找这些PID监听的端口
print()
print('Listening ports for Harness:')
for line in lines:
    if 'LISTENING' in line:
        parts = line.split()
        if len(parts) >= 5:
            pid = parts[4]
            if pid in harness_pids:
                local_addr = parts[1]
                print('  PID=' + pid + ' ' + local_addr)

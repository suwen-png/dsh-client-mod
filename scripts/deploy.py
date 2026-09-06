"""
V10总监控制台一键部署脚本（Python版）
功能：编译 -> 关闭Harness -> 复制 -> 清缓存 -> 重启
用法：python deploy.py [--no-restart] [--no-cache-clear]
"""
import subprocess
import sys
import os
import time
import shutil

NO_RESTART = '--no-restart' in sys.argv
NO_CACHE_CLEAR = '--no-cache-clear' in sys.argv

PLUGIN_DIR = r'C:\Users\15142\.dsh\profiles\web\node_modules\dsh-director\lib'
SOURCE_DIR = r'D:\hermes-data\dsh-director'
HARNESS_EXE = r'D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe'

start = time.time()
print('=== V10一键部署 ===')

# 1. 编译
print('[1/5] 编译...')
os.chdir(SOURCE_DIR)
result = subprocess.run(['node', 'build.mjs'], capture_output=True, text=True)
if result.returncode != 0:
    print('编译失败:', result.stderr)
    sys.exit(1)
compiled = os.path.join(SOURCE_DIR, 'lib', 'client.js')
size = os.path.getsize(compiled)
print(f'  编译成功: {size/1024:.1f}KB')

# 2. 关闭Harness
if not NO_RESTART:
    print('[2/5] 关闭Harness...')
    subprocess.run(['taskkill', '/F', '/IM', 'DeepSeek Harness.exe'], capture_output=True)
    time.sleep(3)
    print('  已关闭')

# 3. 复制
print('[3/5] 复制...')
dest = os.path.join(PLUGIN_DIR, 'client.js')
os.makedirs(PLUGIN_DIR, exist_ok=True)
with open(compiled, 'rb') as f:
    data = f.read()
with open(dest, 'wb') as f:
    f.write(data)
print(f'  复制成功: {len(data)/1024:.1f}KB')

# 4. 清缓存
if not NO_CACHE_CLEAR:
    print('[4/5] 清缓存...')
    cache_dir = os.path.join(os.environ['APPDATA'], '@deepseek-ai', 'dsh-desktop')
    for sub in ['Cache', 'Code Cache', 'GPUCache', 'blob_storage', 'Network']:
        p = os.path.join(cache_dir, sub)
        if os.path.exists(p):
            shutil.rmtree(p, ignore_errors=True)
    print('  缓存已清')

# 5. 启动
if not NO_RESTART:
    print('[5/5] 启动Harness...')
    subprocess.Popen([HARNESS_EXE])
    time.sleep(10)
    print('  已启动')

elapsed = time.time() - start
print(f'=== 完成，耗时{elapsed:.1f}秒 ===')

import subprocess
import time
import os

# 杀死所有Harness相关进程
result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq DeepSeek*'], capture_output=True, text=True)
print("当前Harness进程:")
print(result.stdout)

# 用taskkill杀死
subprocess.run(['taskkill', '/F', '/IM', 'DeepSeek*'], capture_output=True)
time.sleep(3)

# 再次检查
result2 = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq DeepSeek*'], capture_output=True, text=True)
print("\n杀进程后:")
print(result2.stdout)

# 清除缓存
cache_dir = os.path.expandvars(r'%APPDATA%\@deepseek-ai\dsh-desktop')
cache_subdirs = ['Cache', 'Code Cache', 'GPUCache', 'blob_storage', 'Network']
for d in cache_subdirs:
    full = os.path.join(cache_dir, d)
    if os.path.exists(full):
        subprocess.run(['rmdir', '/S', '/Q', full], shell=True)
        print(f"已清除缓存: {d}")

print("\n缓存清除完成，准备启动Harness...")

# 启动Harness
harness_exe = r'D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe'
subprocess.Popen([harness_exe])
print("Harness已启动")

time.sleep(5)
result3 = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq DeepSeek*'], capture_output=True, text=True)
print("\n启动后进程:")
print(result3.stdout)

"""
dsh-client-mod 自动化修改-测试-验证流程
用途：串联 apply → 清缓存 → 重启Harness → 检查log 的完整流程
使用：python scripts/auto-dev.py [--no-restart] [--check-log]
创建日期：2026-08-28
"""
import os
import sys
import time
import subprocess
import shutil
import glob
import argparse

# ========== 配置 ==========
PROJECT_ROOT = r'D:\hermes-data\dsh-client-mod'
APPLY_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'apply.ps1')
HARNESS_EXE = r'D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe'
CACHE_DIR = os.path.join(os.environ.get('APPDATA', ''), '@deepseek-ai', 'dsh-desktop')
LOG_DIR = r'D:\软件下载\edge下载\log'  # Harness log输出目录

# ========== 步骤1: apply修改 ==========
def step_apply():
    print("\n" + "=" * 50)
    print("[步骤1/4] apply 修改...")
    print("=" * 50)
    try:
        result = subprocess.run(
            ['powershell', '-ExecutionPolicy', 'Bypass', '-File', APPLY_SCRIPT],
            capture_output=True, text=True, encoding='utf-8', errors='ignore',
            cwd=PROJECT_ROOT, timeout=60
        )
        # 检查是否成功
        if '应用完成' in result.stdout or '应用完成' in (result.stderr or ''):
            print("  ✓ apply 成功")
            # 显示修改的文件
            for line in result.stdout.split('\n'):
                if '复制:' in line:
                    print(f"    {line.strip()}")
            return True
        else:
            print("  ✗ apply 可能失败")
            print(f"  stdout: {result.stdout[-500:]}")
            print(f"  stderr: {result.stderr[-500:]}")
            return False
    except Exception as e:
        print(f"  ✗ apply 异常: {e}")
        return False

# ========== 步骤2: 杀进程+清缓存 ==========
def step_cleanup():
    print("\n" + "=" * 50)
    print("[步骤2/4] 杀进程 + 清除缓存...")
    print("=" * 50)
    
    # 杀进程
    killed = []
    try:
        result = subprocess.run(
            ['tasklist', '/FO', 'CSV', '/NH'],
            capture_output=True, text=True, encoding='gbk', errors='ignore'
        )
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            parts = line.split('","')
            if len(parts) >= 2:
                name = parts[0].strip('"').lower()
                pid = parts[1].strip('"')
                if any(k in name for k in ['harness', 'dsh', 'deepseek']):
                    try:
                        subprocess.run(['taskkill', '/PID', pid, '/F'], capture_output=True)
                        killed.append((pid, name))
                    except:
                        pass
    except Exception as e:
        print(f"  进程检查异常: {e}")
    
    if killed:
        print(f"  已终止 {len(killed)} 个进程: {', '.join([p for _,p in killed])}")
        time.sleep(3)
    else:
        print("  未找到运行中的Harness进程")
    
    # 清缓存
    if os.path.exists(CACHE_DIR):
        dirs_to_delete = [
            'Cache', 'Code Cache', 'GPUCache', 'blob_storage',
            'Network', 'DawnGraphiteCache', 'DawnWebGPUCache'
        ]
        deleted = 0
        for d in dirs_to_delete:
            path = os.path.join(CACHE_DIR, d)
            if os.path.exists(path):
                try:
                    shutil.rmtree(path)
                    deleted += 1
                except:
                    pass
        print(f"  已清除 {deleted} 个缓存目录")
    else:
        print(f"  缓存目录不存在: {CACHE_DIR}")
    
    return True

# ========== 步骤3: 重启Harness ==========
def step_restart():
    print("\n" + "=" * 50)
    print("[步骤3/4] 启动Harness...")
    print("=" * 50)
    
    if os.path.exists(HARNESS_EXE):
        try:
            subprocess.Popen([HARNESS_EXE], shell=False)
            print(f"  ✓ 已启动: {HARNESS_EXE}")
            print("  等待5秒让Harness完全启动...")
            time.sleep(5)
            return True
        except Exception as e:
            print(f"  ✗ 启动失败: {e}")
            return False
    else:
        print(f"  ✗ 可执行文件不存在: {HARNESS_EXE}")
        return False

# ========== 步骤4: 检查最新log ==========
def step_check_log():
    print("\n" + "=" * 50)
    print("[步骤4/4] 检查最新log...")
    print("=" * 50)
    
    if not os.path.exists(LOG_DIR):
        print(f"  log目录不存在: {LOG_DIR}")
        return None
    
    # 找最新的log文件
    log_files = glob.glob(os.path.join(LOG_DIR, 'dsh-debug-*.log'))
    if not log_files:
        print("  未找到log文件")
        return None
    
    latest_log = max(log_files, key=os.path.getmtime)
    print(f"  最新log: {os.path.basename(latest_log)}")
    
    try:
        with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # 检查关键信息
        checks = {
            'file_storage_available': 'V10 file storage available' in content or 'V9.3 file storage available' in content,
            'file_storage_failed': 'nodeRequire not available' in content or 'file storage init failed' in content,
            'save_to_file_ok': 'save to file: OK' in content,
            'load_from_file': 'load from file' in content,
            'save_verify_ok': 'save-verify: localStorage OK' in content,
            'load_no_data': 'load: no data' in content,
            'idb_save_complete': 'idbSave complete' in content,
        }
        
        print("\n  关键检查结果:")
        for key, value in checks.items():
            status = "✓" if value else "✗"
            print(f"    {status} {key}: {value}")
        
        # 显示最后50行
        lines = content.strip().split('\n')
        print(f"\n  log最后20行 (共{len(lines)}行):")
        print("  " + "-" * 40)
        for line in lines[-20:]:
            print(f"  {line[:120]}")
        
        return checks
    except Exception as e:
        print(f"  读取log失败: {e}")
        return None

# ========== 主流程 ==========
def main():
    parser = argparse.ArgumentParser(description='dsh-client-mod 自动化开发流程')
    parser.add_argument('--no-restart', action='store_true', help='只apply不清缓存不重启')
    parser.add_argument('--check-log', action='store_true', help='只检查log')
    parser.add_argument('--full', action='store_true', help='完整流程: apply→清缓存→重启→检查log')
    args = parser.parse_args()
    
    print("╔" + "═" * 50 + "╗")
    print("║" + "  dsh-client-mod 自动化开发流程".center(48) + "║")
    print("╚" + "═" * 50 + "╝")
    
    if args.check_log:
        step_check_log()
        return
    
    if args.no_restart:
        step_apply()
        return
    
    # 默认完整流程
    success = True
    success &= step_apply()
    if not success:
        print("\n✗ apply失败，终止流程")
        sys.exit(1)
    
    step_cleanup()
    step_restart()
    
    if args.full:
        time.sleep(3)  # 等log写入
        step_check_log()
    
    print("\n" + "=" * 50)
    print("  流程完成！请在Harness中测试功能")
    print("=" * 50)

if __name__ == '__main__':
    main()

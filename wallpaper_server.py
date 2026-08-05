# -*- coding: utf-8 -*-
"""
JH-WallCraft 本地壁纸设置服务
接收浏览器生成的壁纸 PNG，调用 Windows API (SystemParametersInfoW) 设为桌面壁纸。

用法：
    python wallpaper_server.py            # 启动服务（默认端口 18766）
    python wallpaper_server.py --port 9000

浏览器端通过 POST /set 上传 PNG 即可设置桌面壁纸。
"""
import argparse
import ctypes
import io
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Windows API 常量
SPI_SETDESKWALLPAPER = 0x0014
SPIF_UPDATEINIFILE = 0x01
SPIF_SENDCHANGE = 0x02

# 固定壁纸输出路径（与浏览器端约定一致）
DEFAULT_OUT = os.path.join(os.path.expanduser('~'), 'wallcraft_wallpaper.png')


def set_wallpaper(image_bytes, out_path=None):
    """将 PNG 字节写入固定路径并设为桌面壁纸。返回 (ok, message)。"""
    out_path = out_path or DEFAULT_OUT
    try:
        # 写入固定路径（避免壁纸文件被系统锁定后无法覆盖）
        with open(out_path, 'wb') as f:
            f.write(image_bytes)

        # 调用 Windows API 设置壁纸
        SPI_SETDESKWALLPAPER = 0x0014
        SPIF_UPDATEINIFILE = 0x01
        SPIF_SENDCHANGE = 0x02
        result = ctypes.windll.user32.SystemParametersInfoW(
            SPI_SETDESKWALLPAPER, 0, out_path, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
        )
        if result:
            return True, f'壁纸已设置: {out_path}'
        return False, f'SystemParametersInfoW 调用失败 (error={ctypes.get_last_error()})'
    except Exception as e:
        return False, f'设置壁纸失败: {e}'


class WallpaperHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/health'):
            self._send_json(200, {'ok': True, 'service': 'wallcraft-wallpaper-server'})
        else:
            self._send_json(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if not self.path.startswith('/set'):
            self._send_json(404, {'ok': False, 'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            image_bytes = self.rfile.read(length)
            if not image_bytes:
                self._send_json(400, {'ok': False, 'error': 'empty body'})
                return
            ok, msg = set_wallpaper(image_bytes)
            self._send_json(200 if ok else 500, {'ok': ok, 'message': msg})
        except Exception as e:
            self._send_json(500, {'ok': False, 'error': str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write('[wallpaper-server] %s\n' % (fmt % args))


def main():
    parser = argparse.ArgumentParser(description='JH-WallCraft 本地壁纸设置服务')
    parser.add_argument('--port', type=int, default=18766, help='监听端口 (默认 18766)')
    args = parser.parse_args()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), WallpaperHandler)
    print(f'[wallpaper-server] 监听 http://127.0.0.1:{args.port}')
    print(f'[wallpaper-server] 壁纸输出路径: {DEFAULT_OUT}')
    print('[wallpaper-server] 按 Ctrl+C 停止')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[wallpaper-server] 已停止')
        server.server_close()


if __name__ == '__main__':
    main()
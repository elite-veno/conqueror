#!/usr/bin/env python3
"""Conqueror multiplayer server.

Serves the game files over HTTP and relays WebSocket messages between the players of a room.
The host's browser runs the simulation; this server only forwards messages.

Usage: python3 server.py [port]      (default 8000, standard library only)
"""
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import random
import socket
import string
import struct
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_FRAME = 1 << 20          # max incoming message size (clients only send small commands)
MAX_BUFFER = 8 << 20         # drop clients that can't keep up with snapshots
MAX_PLAYERS = 8

rooms = {}


class Conn:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer
        self.id = None
        self.name = ''
        self.room = None

    def send_raw(self, data):
        if self.writer.is_closing():
            return
        if self.writer.transport.get_write_buffer_size() > MAX_BUFFER:
            self.writer.close()
            return
        self.writer.write(data)

    def send(self, obj):
        self.send_raw(frame(1, json.dumps(obj, separators=(',', ':')).encode()))


class Room:
    def __init__(self, code, host):
        self.code = code
        self.host = host
        self.members = {}
        self.counter = 1

    def next_id(self):
        self.counter += 1
        return f'p{self.counter}'


def frame(opcode, payload):
    n = len(payload)
    if n < 126:
        header = struct.pack('!BB', 0x80 | opcode, n)
    elif n < 65536:
        header = struct.pack('!BBH', 0x80 | opcode, 126, n)
    else:
        header = struct.pack('!BBQ', 0x80 | opcode, 127, n)
    return header + payload


def unmask(data, mask):
    n = len(data)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, 'big') ^ int.from_bytes(key, 'big')).to_bytes(n, 'big')


async def read_frame(reader):
    b1, b2 = await reader.readexactly(2)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack('!H', await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack('!Q', await reader.readexactly(8))[0]
    if length > MAX_FRAME:
        raise ValueError('frame too large')
    mask = await reader.readexactly(4) if b2 & 0x80 else None
    data = await reader.readexactly(length)
    if mask:
        data = unmask(data, mask)
    return bool(b1 & 0x80), b1 & 0x0F, data


def new_code():
    while True:
        code = ''.join(random.choice(string.ascii_uppercase) for _ in range(4))
        if code not in rooms:
            return code


def clean_code(code):
    return ''.join(ch for ch in str(code or '').upper() if ch in string.ascii_uppercase)[:4]


def handle_message(conn, m):
    t = m.get('t')
    if conn.room is None:
        conn.name = str(m.get('name') or 'Speler')[:16]
        if t == 'create':
            code = clean_code(m.get('code'))
            if len(code) != 4 or code in rooms:
                code = new_code()
            room = Room(code, conn)
            rooms[code] = room
            conn.room, conn.id = room, 'p1'
            conn.send({'t': 'room', 'code': code, 'you': conn.id, 'host': True})
        elif t == 'join':
            room = rooms.get(clean_code(m.get('code')))
            if not room:
                conn.send({'t': 'error', 'msg': 'Kamer niet gevonden'})
            elif len(room.members) + 1 >= MAX_PLAYERS:
                conn.send({'t': 'error', 'msg': 'Kamer is vol'})
            else:
                conn.room, conn.id = room, room.next_id()
                room.members[conn.id] = conn
                conn.send({'t': 'room', 'code': room.code, 'you': conn.id, 'host': False})
                room.host.send({'t': 'joined', 'id': conn.id, 'name': conn.name})
        return
    room = conn.room
    if t == 'to_host' and conn is not room.host:
        room.host.send({'t': 'msg', 'from': conn.id, 'data': m.get('data')})
    elif t == 'broadcast' and conn is room.host:
        data = frame(1, json.dumps(m.get('data'), separators=(',', ':')).encode())
        for member in list(room.members.values()):
            member.send_raw(data)
    elif t == 'to' and conn is room.host:
        member = room.members.get(m.get('id'))
        if member:
            member.send(m.get('data'))


def handle_close(conn):
    room = conn.room
    if not room:
        return
    if conn is room.host:
        for member in room.members.values():
            member.send({'t': 'hostLeft'})
        rooms.pop(room.code, None)
    else:
        room.members.pop(conn.id, None)
        room.host.send({'t': 'left', 'id': conn.id})


async def websocket(conn):
    parts = []
    try:
        while True:
            fin, opcode, data = await read_frame(conn.reader)
            if opcode == 8:
                break
            if opcode == 9:
                conn.send_raw(frame(10, data))
                continue
            if opcode not in (0, 1):
                continue
            parts.append(data)
            if not fin:
                continue
            raw, parts = b''.join(parts), []
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                handle_message(conn, msg)
    except (asyncio.IncompleteReadError, ConnectionError, ValueError):
        pass
    finally:
        handle_close(conn)


def static_file(path):
    rel = unquote(path.split('?')[0]).lstrip('/') or 'index.html'
    if any(part.startswith('.') for part in rel.split('/')):
        return None
    full = os.path.realpath(os.path.join(ROOT, rel))
    if not full.startswith(ROOT + os.sep) or not os.path.isfile(full):
        return None
    return full


async def handle(reader, writer):
    try:
        head = await reader.readuntil(b'\r\n\r\n')
        lines = head.decode('latin-1').split('\r\n')
        method, path = lines[0].split(' ')[:2]
        headers = {}
        for line in lines[1:]:
            if ':' in line:
                k, v = line.split(':', 1)
                headers[k.strip().lower()] = v.strip()
        if path.split('?')[0] == '/ws' and headers.get('upgrade', '').lower() == 'websocket':
            key = headers.get('sec-websocket-key', '')
            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                          f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode())
            await websocket(Conn(reader, writer))
            return
        full = static_file(path) if method in ('GET', 'HEAD') else None
        if not full:
            writer.write(b'HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot found')
        else:
            with open(full, 'rb') as f:
                body = f.read()
            ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype.endswith('javascript'):
                ctype += '; charset=utf-8'
            writer.write((f'HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n'
                          'Cache-Control: no-cache\r\nConnection: close\r\n\r\n').encode())
            if method == 'GET':
                writer.write(body)
        await writer.drain()
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError, ValueError):
        pass
    finally:
        writer.close()


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    mimetypes.add_type('application/javascript', '.js')
    server = await asyncio.start_server(handle, '0.0.0.0', port)
    print(f'Conqueror draait op http://localhost:{port}')
    print(f'Andere spelers in je netwerk: http://{lan_ip()}:{port}')
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

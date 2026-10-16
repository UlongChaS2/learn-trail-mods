"""패널 키 문제를 찾을 때 쓴다. 누른 키가 프로그램에 어떤 바이트로 들어오는지 찍는다. q 두 번이면 끝.

kitty 키보드 프로토콜을 켠 상태(Claude 와 같은 조건)로 읽는다.
"""
import os
import sys
import termios
import tty

fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
# 1 = 모호한 키 구분, 4 = 영문 자판 위치(base layout key) 같이 보내기, 8 = 모든 키를 이스케이프로
sys.stdout.write("\x1b[>13u")
sys.stdout.flush()
print("키를 눌러 보세요: ctrl+g(영문), ctrl+ㅎ(한글), alt+g(영문), alt+ㅎ(한글). q 두 번 = 끝\r")
last = b""
try:
    tty.setraw(fd)
    while True:
        b = os.read(fd, 64)
        shown = b.decode("utf-8", "backslashreplace").replace("\x1b", "ESC")
        sys.stdout.write(f"{b.hex(' ')}    {shown!r}\r\n")
        sys.stdout.flush()
        if b in (b"q", b"\x1b[113u") and last == b:
            break
        last = b
finally:
    sys.stdout.write("\x1b[<u")
    termios.tcsetattr(fd, termios.TCSADRAIN, old)

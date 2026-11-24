# PyInstaller recipe for the bundled backend: builds dist/flick-backend/flick-backend(.exe).
# Build (from backend/):  pyinstaller flick.spec --noconfirm
# The desktop installer copies dist/flick-backend into resources/backend (see apps/electron/package.json).
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Packages with data files or native libraries that PyInstaller can't find on its own.
for package in ("faster_whisper", "ctranslate2", "fastembed", "onnxruntime", "tokenizers", "pptx", "av"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

# uvicorn picks its servers and protocols at run time.
hiddenimports += collect_submodules("uvicorn")
if sys.platform == "win32":
    hiddenimports += ["win32com", "win32com.client", "pythoncom", "pywintypes"]

a = Analysis(
    ["run_flick.py"],
    pathex=["."],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "pytest", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="flick-backend",
    console=True,  # Electron hides the window (windowsHide) and reads its output
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="flick-backend", upx=False)

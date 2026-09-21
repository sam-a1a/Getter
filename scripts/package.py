"""Build an unpackable extension ZIP; no build tools needed at runtime."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
out = root / 'dist'
out.mkdir(exist_ok=True)
with ZipFile(out / 'Getter-Chrome.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'extension').rglob('*')):
        if path.is_file() and not path.name.startswith('.'):
            archive.write(path, Path('Getter') / path.relative_to(root / 'extension'))
    archive.write(root / 'README.md', 'Getter/INSTALL.md')
print(out / 'Getter-Chrome.zip')

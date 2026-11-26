"""검증된 서비스 체크포인트를 별도 CPU 추론 번들로 내보낸다."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

import torch
from transformers import AutoModelForSequenceClassification

FILES = {
    "model.safetensors": "ed51b206d2f7911a43a8c99e103df99d0b767347cada70767a7a8ce40e63bf94",
    "config.json": "9ad8bdc6c8437b5c0e75290500a45b76d8734b85dcd72257ba136fa3e7ef543f",
    "tokenizer.json": "5f1b31bbd2e604c54feba7c7bb9d819394898d48015294eb6a2dd3ff717f7bb0",
    "tokenizer_config.json": "1859a0ba13fa41b4c652785cd6eab79d554e1e4174038893118ef53772bc0125",
    "special_tokens_map.json": "5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a",
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class Logits(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.model(input_ids=input_ids, attention_mask=attention_mask,
                          token_type_ids=token_type_ids).logits


G2_FILES = {**FILES,
    "config.json": "0ac21c0b6c4ee4721ca7f4717494a3482a3dd9245d690362dcbc349d56aaaefc",
    "model.safetensors": "8456e235a78aaf19ab018b9459bf9857394308057ce5ee9f8f87b793b256cd6c"}

def export(source, destination, files=FILES):
    if destination.exists():
        raise FileExistsError(destination)
    for name, expected in files.items():
        if digest(source / name) != expected:
            raise ValueError(f"서비스 체크포인트 파일 불일치: {name}")
    model = Logits(AutoModelForSequenceClassification.from_pretrained(
        source, local_files_only=True, attn_implementation="eager")).eval()
    names = ["input_ids", "attention_mask", "token_type_ids"]
    sample = torch.ones((1, 8), dtype=torch.long)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        bundle = Path(tmp) / "bundle"
        bundle.mkdir()
        torch.onnx.export(model, (sample, sample, torch.zeros_like(sample)), bundle / "model.onnx",
                          input_names=names, output_names=["logits"], opset_version=17,
                          dynamic_axes={**{n: {0: "batch", 1: "sequence"} for n in names},
                                        "logits": {0: "batch"}}, dynamo=False, external_data=False)
        shutil.copyfile(source / "tokenizer.json", bundle / "tokenizer.json")
        manifest = {"source": files, "onnx_sha256": digest(bundle / "model.onnx")}
        (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        bundle.rename(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--g2", action="store_true")
    args = parser.parse_args()
    export(args.source, args.destination, G2_FILES if args.g2 else FILES)


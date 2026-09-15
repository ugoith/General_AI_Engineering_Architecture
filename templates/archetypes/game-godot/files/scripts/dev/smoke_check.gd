# 用 `godot --headless --path . -s scripts/dev/smoke_check.gd` 运行；失败时退出码非 0，可直接用于 CI 与提交前检查。
# 本脚本只做"脚本能被解析、关键 autoload 存在"这类最便宜的校验，不替代测试框架。
extends SceneTree

const REQUIRED_AUTOLOAD := "Game"          # 与 project.godot 的 [autoload] 保持一致
const REQUIRED_PATHS := [
	"res://scenes/Main.tscn",
	"res://scripts/autoload/game.gd",
]

func _initialize() -> void:
	var failures: Array[String] = []

	for path in REQUIRED_PATHS:
		if not ResourceLoader.exists(path):
			failures.append("missing resource: %s" % path)

	if root.get_node_or_null(NodePath("/root/" + REQUIRED_AUTOLOAD)) == null:
		failures.append("autoload not registered: %s (check project.godot)" % REQUIRED_AUTOLOAD)

	if failures.is_empty():
		print("smoke_check: OK")
		quit(0)
	else:
		for message in failures:
			printerr("smoke_check: FAIL ", message)
		quit(1)

# autoload 服务入口：在 project.godot 中注册为单例名 `Game`（注意别与 class_name Game 冲突，名称必须一致）。
# 职责边界（严格遵守，见 {{docsDir}}/architecture/autoload-and-signals.md）：
#   只做"全局服务"：流程切换、存档/设置读写、跨场景事件转发。
#   不做业务规则（伤害、掉落、关卡逻辑都在各自模块里）。
extends Node

## 场景切换请求（UI 只管发信号，不直接调用 change_scene_to_file）
signal scene_change_requested(scene_path: String)

## 流程切换完成（参数为切换后的场景路径）
signal scene_changed(scene_path: String)

const SAVE_PATH := "user://save.json"          # 可变数据只能写 user://，不能写 res://
const SETTINGS_PATH := "user://settings.json"

## 业务侧通过 Game.change_scene() 请求切换；实际切换在 _process 里做，避免在信号回调中重入
var _pending_scene_path: String = ""

func _ready() -> void:
	scene_change_requested.connect(change_scene)

## 请求切换场景（安全：只登记意图，真正切换发生在下一帧）
func change_scene(scene_path: String) -> void:
	if not ResourceLoader.exists(scene_path):
		push_error("change_scene: resource not found: %s" % scene_path)
		return
	_pending_scene_path = scene_path

func _process(_delta: float) -> void:
	if _pending_scene_path.is_empty():
		return
	var target := _pending_scene_path
	_pending_scene_path = ""
	var error := get_tree().change_scene_to_file(target)
	if error != OK:
		push_error("change_scene: failed (%d) for %s" % [error, target])
		return
	scene_changed.emit(target)

## 存档读写：格式变更属于数据契约变更，必须先写 ADR
func save_game(payload: Dictionary) -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		push_error("save_game: cannot open %s" % SAVE_PATH)
		return
	file.store_string(JSON.stringify(payload))
	file.close()

func load_game() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		push_error("load_game: cannot open %s" % SAVE_PATH)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("load_game: malformed save, starting fresh")
		return {}
	return parsed

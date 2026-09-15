using Godot;
// C# 版 autoload 骨架。**本项目同一时刻只能存在一个 autoload 脚本实现**：
//   - 使用 GDScript 的项目：删除本文件，保留 scripts/autoload/game.gd；
//   - 使用 C# 的项目（.NET 版 Godot，见 .ai/constitution.md 第 1 节）：删除 game.gd，并把 project.godot 的
//     [autoload] 指向本文件的 .cs 资源，单例名保持 `Game`。
//
// 与 GDScript 版保持一致的行为契约：
//   - 只做全局服务：场景切换、存档/设置读写，不含业务规则；
//   - 可变数据只能写 user://，禁止写 res://；
//   - 场景切换延后到 _Process 执行，避免在信号回调中重入。

public partial class Game : Node
{
    [Signal] public delegate void SceneChangeRequestedEventHandler(string scenePath);
    [Signal] public delegate void SceneChangedEventHandler(string scenePath);

    private const string SavePath = "user://save.json";

    private string _pendingScenePath = "";

    public override void _Ready()
    {
        SceneChangeRequested += ChangeScene;
    }

    public void ChangeScene(string scenePath)
    {
        if (!ResourceLoader.Exists(scenePath))
        {
            GD.PushError($"change_scene: resource not found: {scenePath}");
            return;
        }
        _pendingScenePath = scenePath;
    }

    public override void _Process(double delta)
    {
        if (string.IsNullOrEmpty(_pendingScenePath))
        {
            return;
        }

        var target = _pendingScenePath;
        _pendingScenePath = "";
        var error = GetTree().ChangeSceneToFile(target);
        if (error != Error.Ok)
        {
            GD.PushError($"change_scene: failed ({error}) for {target}");
            return;
        }
        EmitSignal(SignalName.SceneChanged, target);
    }
}

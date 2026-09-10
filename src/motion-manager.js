/* Renderer-only action registry. Add a handler without changing panel or IPC dispatch. */
(() => {
  class MotionManager {
    constructor() {
      this.handlers = new Map(); this.model = null; this.loop = null; this.epoch = 0;
      this.register('motion', async (model, action, valid) => {
        const motion = await model.internalModel.motionManager.loadMotion(action.group, action.index);
        if (!motion) throw new Error('动作资源加载失败');
        if (!valid()) return false;
        motion.setIsLoop(false); // User loop mode is controlled by motionFinish, independent of file defaults.
        return model.motion(action.group, action.index, 3);
      });
      this.register('expression', async (model, action) => model.expression(action.id));
      this.finished = () => {
        const action = this.loop;
        if (action) setTimeout(() => { if (this.loop === action) this.play(action, true).catch(this.onError); }, 0);
      };
      this.onError = error => window.desktopAPI?.reportMotion({ ok: false, message: error.message });
    }
    register(type, handler) { this.handlers.set(type, handler); }
    attach(model) {
      this.stop(); this.model?.internalModel.motionManager.off('motionFinish', this.finished);
      this.model = model;
      if (model) {
        model.internalModel.motionManager.groups.idle = '__desktop_no_auto_idle__';
        model.internalModel.motionManager.on('motionFinish', this.finished);
      }
    }
    async play(action, loop = false) {
      const handler = this.handlers.get(action?.type);
      if (!this.model || !handler) throw new Error('请先加载支持该行为的模型');
      const epoch = ++this.epoch, model = this.model;
      this.loop = loop && action.type === 'motion' ? action : null;
      model.internalModel.motionManager.stopAllMotions();
      const result = await handler(model, action, () => epoch === this.epoch && model === this.model);
      if (epoch !== this.epoch || model !== this.model) return false;
      if (result === false) { this.loop = null; throw new Error(`无法播放：${action.label || action.id || action.group}`); }
      window.desktopAPI?.reportMotion({ ok: true, message: `${loop ? '循环播放' : '已播放'}：${action.label || action.id || action.group}` });
      return true;
    }
    stop() {
      this.epoch++; this.loop = null;
      this.model?.internalModel.motionManager.stopAllMotions();
      this.model?.internalModel.motionManager.expressionManager?.resetExpression();
    }
  }
  window.MotionManager = MotionManager;
})();

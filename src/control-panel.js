window.ControlPanel = {
  menus: [
    { id: 'models', label: '模型', icon: '◇', subtitle: '为桌面选择一位伙伴' },
    { id: 'behavior', label: '行为', icon: '▷', subtitle: '探索模型的动作与表情' },
    { id: 'chat', label: '聊天框', icon: '▤', subtitle: '调整每次相遇的样子' },
    { id: 'options', label: '选项', icon: '⚙', subtitle: '让助手适应你的桌面' }
  ],
  fields: {
    chat: [
      { title: '外观', fields: [ ['bubbleRadius','圆角','range',0,48,1], ['bubbleOpacity','背景不透明度','range',.2,1,.05], ['bubbleFontSize','字体大小','range',11,22,1], ['bubbleColor','背景颜色','color'], ['bubbleShadow','柔和阴影','checkbox'] ] },
      { title: '尺寸与位置', fields: [ ['bubbleSize.width','宽度','number',300,720], ['bubbleSize.height','高度','number',280,640], ['bubbleOffset.x','水平偏移','number',-5000,5000], ['bubbleOffset.y','垂直偏移','number',-5000,5000], ['bubbleDisplay','显示方式','select', [['click','点击模型时'],['always','加载后显示'],['hidden','隐藏聊天框']]] ] },
      { title: '出现动画', fields: [ ['bubbleFadeIn','淡入动画','checkbox'], ['bubbleFadeDuration','动画时长（毫秒）','range',100,1200,50] ] }
    ],
    options: [
      { title: '桌面与窗口', fields: [ ['autoStart','开机自启动','checkbox'], ['alwaysOnTop','始终置顶','checkbox'], ['opacity','窗口不透明度','range',.35,1,.05], ['windowSize.width','桌宠窗口宽度','number',320,2000], ['windowSize.height','桌宠窗口高度','number',420,2000], ['showDesktopBorder','显示桌宠窗口边框','checkbox'], ['layoutLocked','锁定布局','checkbox'] ] },
      { title: '模型与主题', fields: [ ['modelScale','模型缩放','range',.65,1.45,.05], ['modelPosition.x','模型水平位置','number',-500,500], ['modelPosition.y','模型垂直位置','number',-500,500], ['theme','颜色方案','select', [['light','浅蓝灰'],['dark','深色']]] ] },
      { title: '数据来源', fields: [ ['dataSourceMode','数据来源模式','select',[['demo','本地演示数据'],['bridge','本机 JSON 桥接']]], ['bridgeUrl','本机 JSON 地址','url'], ['refreshMinutes','刷新间隔（分钟）','number',1,60] ] }
    ]
  },
  registerMenu(menu) { this.menus.push(menu); },
  registerFields(page, section) { (this.fields[page] ||= []).push(section); }
};

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 渲染错误兜底。
 *
 * 为什么必须有：React 在渲染期间抛错会**卸载整棵树**，页面上什么都不剩 ——
 * 对家长和孩子来说就是「打开是一片空白」，完全无法定位。
 *
 * 这个组件把崩溃变成一条可读、可截图、可恢复的信息。
 * （外层还有 index.html 里的兜底脚本，负责模块压根没加载起来的情况。）
 *
 * 一处刻意的取舍：这里用内联样式而不是设计 Token —— 因为它要能在
 * 样式表本身加载失败的情况下依然可读。
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 留在控制台里，便于真机上通过 Safari 调试器查看
    console.error('[小钢琴] 渲染错误：', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          maxWidth: '36rem',
          margin: '12vh auto',
          padding: '0 1.5rem',
          font: '16px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
          color: '#252824',
        }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>这里出了一点问题</h1>
        <p style={{ color: '#6f746d', margin: '0 0 16px' }}>
          琴键暂时打不开了。可以重试一次；如果还是不行，把下面的信息截图发给开发者。
        </p>
        <pre
          style={{
            background: '#f1f2ee',
            border: '1px solid #e3e5df',
            borderRadius: 12,
            padding: 14,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            margin: 0,
          }}
        >
          <strong>{error.name}: {error.message}</strong>
          {'\n'}
          {error.stack ?? '(没有堆栈信息)'}
          {'\n\nUA: '}
          {navigator.userAgent}
        </pre>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              minHeight: 48,
              padding: '0 24px',
              borderRadius: 12,
              border: '1px solid #d0d4cc',
              background: '#ffffff',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              minHeight: 48,
              padding: '0 24px',
              borderRadius: 12,
              border: '1px solid #4c8a67',
              background: '#4c8a67',
              color: '#ffffff',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

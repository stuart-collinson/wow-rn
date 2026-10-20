import { NativeTabs } from 'expo-router/native-tabs'

const TabsLayout = () => (
  <NativeTabs>
    <NativeTabs.Trigger name="index">
      <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md={{ default: 'home', selected: 'home' }} />
      <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
  </NativeTabs>
)

export default TabsLayout

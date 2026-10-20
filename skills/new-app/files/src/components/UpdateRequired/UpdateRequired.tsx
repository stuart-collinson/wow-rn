import { Linking, View } from 'react-native'
import * as StoreReview from 'expo-store-review'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

const openStore = async () => {
  const url = StoreReview.storeUrl()
  if (url) await Linking.openURL(url)
}

const UpdateRequired = () => (
  <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
    <Text className="text-center text-2xl font-bold text-foreground">Update required</Text>
    <Text className="text-center text-muted-foreground">
      This version is no longer supported. Please update to keep using the app.
    </Text>
    <Button onPress={openStore}>
      <Text>Open the store</Text>
    </Button>
  </View>
)

export default UpdateRequired
